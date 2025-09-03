# TeamSync Infrastructure with Terraform
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
  }

  backend "s3" {
    bucket = "teamsync-terraform-state"
    key    = "production/terraform.tfstate"
    region = "us-west-2"
    
    dynamodb_table = "teamsync-terraform-locks"
    encrypt        = true
  }
}

# Variables
variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "teamsync-cluster"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "node_instance_types" {
  description = "EC2 instance types for worker nodes"
  type        = list(string)
  default     = ["t3.medium", "t3.large"]
}

variable "min_size" {
  description = "Minimum number of worker nodes"
  type        = number
  default     = 2
}

variable "max_size" {
  description = "Maximum number of worker nodes"
  type        = number
  default     = 10
}

variable "desired_size" {
  description = "Desired number of worker nodes"
  type        = number
  default     = 3
}

# Data sources
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# VPC and networking
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = "10.0.0.0/16"

  azs             = slice(data.aws_availability_zones.available.names, 0, 3)
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway = true
  enable_vpn_gateway = false
  enable_dns_hostnames = true
  enable_dns_support = true

  # Enable flow logs for security monitoring
  enable_flow_log = true
  create_flow_log_cloudwatch_iam_role = true
  create_flow_log_cloudwatch_log_group = true

  tags = {
    Environment = var.environment
    Project     = "teamsync"
    Terraform   = "true"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# EKS Cluster
module "eks" {
  source = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"

  cluster_name    = var.cluster_name
  cluster_version = "1.28"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Cluster endpoint configuration
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true
  cluster_endpoint_public_access_cidrs = ["0.0.0.0/0"]

  # Cluster encryption
  cluster_encryption_config = {
    provider_key_arn = aws_kms_key.eks.arn
    resources        = ["secrets"]
  }

  # Cluster logging
  cluster_enabled_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  # EKS managed node groups
  eks_managed_node_groups = {
    main = {
      name           = "main-node-group"
      instance_types = var.node_instance_types
      
      min_size     = var.min_size
      max_size     = var.max_size
      desired_size = var.desired_size

      # Node group configuration
      ami_type       = "AL2_x86_64"
      capacity_type  = "ON_DEMAND"
      disk_size      = 50

      # Auto Scaling Group tags
      asg_tags = {
        Environment = var.environment
        Project     = "teamsync"
      }

      # Node labels
      labels = {
        Environment = var.environment
        NodeGroup   = "main"
      }

      # Node taints for workload isolation
      taints = []

      update_config = {
        max_unavailable_percentage = 25
      }
    }

    # Spot instances for cost optimization
    spot = {
      name           = "spot-node-group"
      instance_types = ["t3.medium", "t3.large", "t3.xlarge"]
      
      min_size     = 0
      max_size     = 5
      desired_size = 1

      capacity_type = "SPOT"
      disk_size     = 50

      labels = {
        Environment = var.environment
        NodeGroup   = "spot"
        LifeCycle   = "spot"
      }

      taints = [
        {
          key    = "spot-instance"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      ]
    }
  }

  # AWS Load Balancer Controller
  node_security_group_additional_rules = {
    ingress_allow_access_from_control_plane = {
      type                          = "ingress"
      protocol                      = "tcp"
      from_port                     = 9443
      to_port                       = 9443
      source_cluster_security_group = true
      description                   = "Allow access from control plane to webhook port of AWS load balancer controller"
    }
  }

  tags = {
    Environment = var.environment
    Project     = "teamsync"
    Terraform   = "true"
  }
}

# KMS key for EKS encryption
resource "aws_kms_key" "eks" {
  description             = "EKS Secret Encryption Key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Name        = "${var.cluster_name}-eks-encryption-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "eks" {
  name          = "alias/${var.cluster_name}-eks"
  target_key_id = aws_kms_key.eks.key_id
}

# RDS for PostgreSQL
resource "aws_db_subnet_group" "postgres" {
  name       = "${var.cluster_name}-postgres-subnet-group"
  subnet_ids = module.vpc.private_subnets

  tags = {
    Name        = "${var.cluster_name} PostgreSQL DB subnet group"
    Environment = var.environment
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.cluster_name}-rds-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.cluster_name}-rds-security-group"
    Environment = var.environment
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${var.cluster_name}-postgres"

  # Engine configuration
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.medium"

  # Storage configuration
  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id           = aws_kms_key.rds.arn

  # Database configuration
  db_name  = "teamsync"
  username = "postgres"
  password = random_password.db_password.result

  # Networking
  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # Backup configuration
  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"

  # Performance Insights
  performance_insights_enabled = true
  performance_insights_retention_period = 7

  # Enhanced monitoring
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_enhanced_monitoring.arn

  # Deletion protection
  deletion_protection = true
  skip_final_snapshot = false
  final_snapshot_identifier = "${var.cluster_name}-postgres-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  tags = {
    Name        = "${var.cluster_name}-postgres"
    Environment = var.environment
  }
}

# RDS KMS key
resource "aws_kms_key" "rds" {
  description             = "RDS encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Name        = "${var.cluster_name}-rds-encryption-key"
    Environment = var.environment
  }
}

# Random password for database
resource "random_password" "db_password" {
  length  = 32
  special = true
}

# Store password in AWS Secrets Manager
resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${var.cluster_name}-db-password"
  description             = "PostgreSQL database password"
  recovery_window_in_days = 30

  tags = {
    Environment = var.environment
    Project     = "teamsync"
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = aws_db_instance.postgres.username
    password = random_password.db_password.result
    engine   = "postgres"
    host     = aws_db_instance.postgres.endpoint
    port     = aws_db_instance.postgres.port
    dbname   = aws_db_instance.postgres.db_name
  })
}

# ElastiCache for Redis
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.cluster_name}-redis-subnet-group"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.cluster_name}-redis-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  tags = {
    Name        = "${var.cluster_name}-redis-security-group"
    Environment = var.environment
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id         = "${var.cluster_name}-redis"
  description                  = "Redis cluster for TeamSync"

  # Node configuration
  node_type                    = "cache.t3.medium"
  num_cache_clusters          = 2
  port                        = 6379
  parameter_group_name        = "default.redis7"

  # Networking
  subnet_group_name           = aws_elasticache_subnet_group.redis.name
  security_group_ids          = [aws_security_group.redis.id]

  # Security
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = random_password.redis_auth.result

  # Backup
  snapshot_retention_limit    = 5
  snapshot_window            = "03:00-05:00"

  # Maintenance
  maintenance_window         = "sun:05:00-sun:07:00"
  auto_minor_version_upgrade = true

  tags = {
    Name        = "${var.cluster_name}-redis"
    Environment = var.environment
  }
}

resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

# IAM role for RDS enhanced monitoring
resource "aws_iam_role" "rds_enhanced_monitoring" {
  name_prefix = "${var.cluster_name}-rds-monitoring-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  role       = aws_iam_role.rds_enhanced_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# S3 bucket for backups and file storage
resource "aws_s3_bucket" "backups" {
  bucket = "${var.cluster_name}-backups-${random_id.bucket_suffix.hex}"

  tags = {
    Name        = "${var.cluster_name}-backups"
    Environment = var.environment
    Purpose     = "database-backups"
  }
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_encryption" "backups" {
  bucket = aws_s3_bucket.backups.id

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        kms_master_key_id = aws_kms_key.s3.arn
        sse_algorithm     = "aws:kms"
      }
    }
  }
}

resource "aws_kms_key" "s3" {
  description             = "S3 bucket encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Name        = "${var.cluster_name}-s3-encryption-key"
    Environment = var.environment
  }
}

# Lifecycle policy for backup retention
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "backup_lifecycle"
    status = "Enabled"

    # Move to IA after 30 days
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    # Move to Glacier after 90 days
    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    # Delete after 7 years
    expiration {
      days = 2555
    }

    # Clean up incomplete multipart uploads
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/eks/${var.cluster_name}/application"
  retention_in_days = 30

  tags = {
    Environment = var.environment
    Project     = "teamsync"
  }
}

resource "aws_cloudwatch_log_group" "audit" {
  name              = "/aws/eks/${var.cluster_name}/audit"
  retention_in_days = 90

  tags = {
    Environment = var.environment
    Project     = "teamsync"
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.cluster_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets           = module.vpc.public_subnets

  enable_deletion_protection = true
  enable_http2              = true

  # Access logs
  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "alb-logs"
    enabled = true
  }

  tags = {
    Name        = "${var.cluster_name}-alb"
    Environment = var.environment
  }
}

resource "aws_security_group" "alb" {
  name_prefix = "${var.cluster_name}-alb-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.cluster_name}-alb-security-group"
    Environment = var.environment
  }
}

# S3 bucket for ALB access logs
resource "aws_s3_bucket" "alb_logs" {
  bucket = "${var.cluster_name}-alb-logs-${random_id.bucket_suffix.hex}"

  tags = {
    Name        = "${var.cluster_name}-alb-logs"
    Environment = var.environment
  }
}

# Route53 for DNS
resource "aws_route53_zone" "main" {
  name = "teamsync.com"

  tags = {
    Environment = var.environment
    Project     = "teamsync"
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.teamsync.com"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id               = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "teamsync.com"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id               = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# ACM Certificate
resource "aws_acm_certificate" "main" {
  domain_name       = "teamsync.com"
  subject_alternative_names = ["*.teamsync.com"]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "${var.cluster_name}-certificate"
    Environment = var.environment
  }
}

# WAF for application protection
resource "aws_wafv2_web_acl" "main" {
  name  = "${var.cluster_name}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Rate limiting rule
  rule {
    name     = "RateLimitRule"
    priority = 1

    override_action {
      none {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRule"
      sampled_requests_enabled   = true
    }

    action {
      block {}
    }
  }

  # AWS Managed Rules
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  tags = {
    Name        = "${var.cluster_name}-waf"
    Environment = var.environment
  }
}

# CloudFront distribution for global CDN
resource "aws_cloudfront_distribution" "main" {
  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "teamsync-alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  aliases = ["teamsync.com", "www.teamsync.com"]

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "teamsync-alb"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type"]

      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # Cache behavior for API routes
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "teamsync-alb"
    compress               = true
    viewer_protocol_policy = "https-only"

    forwarded_values {
      query_string = true
      headers      = ["*"]

      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.main.arn
    ssl_support_method  = "sni-only"
  }

  web_acl_id = aws_wafv2_web_acl.main.arn

  tags = {
    Name        = "${var.cluster_name}-cloudfront"
    Environment = var.environment
  }
}

# Outputs
output "cluster_endpoint" {
  description = "Endpoint for EKS control plane"
  value       = module.eks.cluster_endpoint
}

output "cluster_security_group_id" {
  description = "Security group ID attached to the EKS cluster"
  value       = module.eks.cluster_security_group_id
}

output "cluster_iam_role_name" {
  description = "IAM role name associated with EKS cluster"
  value       = module.eks.cluster_iam_role_name
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data required to communicate with the cluster"
  value       = module.eks.cluster_certificate_authority_data
}

output "cluster_name" {
  description = "The name of the EKS cluster"
  value       = module.eks.cluster_name
}

output "database_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive   = true
}

output "load_balancer_dns" {
  description = "DNS name of the load balancer"
  value       = aws_lb.main.dns_name
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.main.domain_name
}