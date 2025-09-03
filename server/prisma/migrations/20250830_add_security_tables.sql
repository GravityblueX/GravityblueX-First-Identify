-- Add security and compliance tables

-- User sessions for secure session management
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_info" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_activity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- Audit logs for security monitoring
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "details" JSONB,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Data processing records for GDPR compliance
CREATE TABLE "data_processing_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "processing_purpose" TEXT NOT NULL,
    "legal_basis" TEXT NOT NULL,
    "retention_period" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "consent_date" TIMESTAMP(3),
    "withdrawal_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_processing_records_pkey" PRIMARY KEY ("id")
);

-- GDPR requests tracking
CREATE TABLE "gdpr_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "request_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completion_date" TIMESTAMP(3),
    "request_details" JSONB,
    "response" JSONB,
    "processed_by" TEXT,

    CONSTRAINT "gdpr_requests_pkey" PRIMARY KEY ("id")
);

-- Security incidents tracking
CREATE TABLE "security_incidents" (
    "id" TEXT NOT NULL,
    "incident_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affected_users" TEXT[],
    "detection_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution_time" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "mitigation_steps" JSONB,
    "lessons_learned" TEXT,

    CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id")
);

-- API keys for service integrations
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "user_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "last_used" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraints
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_processing_records" ADD CONSTRAINT "data_processing_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gdpr_requests" ADD CONSTRAINT "gdpr_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create indexes for performance
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");
CREATE INDEX "audit_logs_event_type_idx" ON "audit_logs"("event_type");
CREATE INDEX "data_processing_records_user_id_idx" ON "data_processing_records"("user_id");
CREATE INDEX "gdpr_requests_user_id_idx" ON "gdpr_requests"("user_id");
CREATE INDEX "gdpr_requests_status_idx" ON "gdpr_requests"("status");
CREATE INDEX "security_incidents_severity_idx" ON "security_incidents"("severity");
CREATE INDEX "security_incidents_status_idx" ON "security_incidents"("status");
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");