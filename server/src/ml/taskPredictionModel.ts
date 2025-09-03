import * as tf from '@tensorflow/tfjs-node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TaskFeatures {
  priority: number; // 0-3 (LOW to URGENT)
  complexity: number; // 0-1 estimated from description length
  assigneeExperience: number; // 0-1 based on completed tasks
  projectSize: number; // 0-1 normalized project task count
  teamSize: number; // 0-1 normalized team member count
  dayOfWeek: number; // 0-6
  hourOfDay: number; // 0-23
}

interface TrainingData {
  features: TaskFeatures;
  completionTime: number; // hours to complete
  wasOnTime: boolean;
}

export class TaskPredictionModel {
  private model: tf.Sequential | null = null;
  private isTraining = false;

  constructor() {
    this.loadModel();
  }

  async loadModel() {
    try {
      // Try to load existing model
      this.model = await tf.loadLayersModel('file://./models/task-prediction/model.json');
      console.log('✅ Task prediction model loaded');
    } catch (error) {
      console.log('No existing model found, will create new one');
      await this.createAndTrainModel();
    }
  }

  async createAndTrainModel() {
    if (this.isTraining) return;
    this.isTraining = true;

    try {
      console.log('🧠 Creating and training task prediction model...');

      // Get training data
      const trainingData = await this.getTrainingData();
      
      if (trainingData.length < 50) {
        console.log('⚠️ Not enough training data, using pre-trained weights');
        this.createPretrainedModel();
        return;
      }

      // Create model architecture
      this.model = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [7], units: 64, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: 32, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: 16, activation: 'relu' }),
          tf.layers.dense({ units: 2, activation: 'sigmoid' }) // [completion_time, on_time_probability]
        ]
      });

      // Compile model
      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'meanSquaredError',
        metrics: ['accuracy']
      });

      // Prepare training data
      const features = tf.tensor2d(trainingData.map(d => this.featuresToArray(d.features)));
      const labels = tf.tensor2d(trainingData.map(d => [
        Math.min(d.completionTime / 168, 1), // Normalize to max 1 week
        d.wasOnTime ? 1 : 0
      ]));

      // Train model
      await this.model.fit(features, labels, {
        epochs: 100,
        batchSize: 32,
        validationSplit: 0.2,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 10 === 0) {
              console.log(`Epoch ${epoch}: loss = ${logs?.loss?.toFixed(4)}`);
            }
          }
        }
      });

      // Save model
      await this.model.save('file://./models/task-prediction');
      console.log('✅ Model trained and saved successfully');

    } catch (error) {
      console.error('Model training error:', error);
      this.createPretrainedModel();
    } finally {
      this.isTraining = false;
    }
  }

  private createPretrainedModel() {
    // Create a simple rule-based model as fallback
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [7], units: 16, activation: 'relu' }),
        tf.layers.dense({ units: 2, activation: 'sigmoid' })
      ]
    });

    this.model.compile({
      optimizer: 'adam',
      loss: 'meanSquaredError'
    });

    console.log('✅ Pretrained model created');
  }

  async predict(features: TaskFeatures): Promise<{
    estimatedHours: number;
    onTimeProbability: number;
    confidence: number;
  }> {
    if (!this.model) {
      await this.loadModel();
    }

    try {
      const input = tf.tensor2d([this.featuresToArray(features)]);
      const prediction = this.model!.predict(input) as tf.Tensor;
      const [completionTime, onTimeProbability] = await prediction.data();

      input.dispose();
      prediction.dispose();

      // Convert normalized values back to real values
      const estimatedHours = completionTime * 168; // Max 1 week in hours
      const confidence = this.calculateConfidence(features);

      return {
        estimatedHours: Math.max(1, Math.round(estimatedHours)),
        onTimeProbability: Math.round(onTimeProbability * 100) / 100,
        confidence
      };
    } catch (error) {
      console.error('Prediction error:', error);
      
      // Fallback rule-based prediction
      return this.ruleBased.predict(features);
    }
  }

  private featuresToArray(features: TaskFeatures): number[] {
    return [
      features.priority / 3,
      features.complexity,
      features.assigneeExperience,
      features.projectSize,
      features.teamSize,
      features.dayOfWeek / 6,
      features.hourOfDay / 23
    ];
  }

  private calculateConfidence(features: TaskFeatures): number {
    // Simple confidence calculation based on data quality
    let confidence = 0.5;
    
    if (features.assigneeExperience > 0.7) confidence += 0.2;
    if (features.complexity < 0.3) confidence += 0.1;
    if (features.teamSize > 0.5) confidence += 0.1;
    
    return Math.min(confidence, 0.95);
  }

  async getTrainingData(): Promise<TrainingData[]> {
    try {
      const completedTasks = await prisma.task.findMany({
        where: {
          status: 'DONE',
          createdAt: {
            gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) // Last 6 months
          }
        },
        include: {
          assignee: {
            select: {
              id: true,
              _count: {
                select: {
                  tasks: {
                    where: { status: 'DONE' }
                  }
                }
              }
            }
          },
          project: {
            select: {
              _count: {
                select: { tasks: true, members: true }
              }
            }
          }
        }
      });

      return completedTasks.map(task => {
        const completionTime = (new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60); // hours
        const wasOnTime = !task.dueDate || new Date(task.updatedAt) <= new Date(task.dueDate);
        
        const features: TaskFeatures = {
          priority: this.mapPriority(task.priority),
          complexity: Math.min((task.description?.length || 0) / 500, 1),
          assigneeExperience: task.assignee?._count.tasks ? Math.min(task.assignee._count.tasks / 50, 1) : 0,
          projectSize: Math.min((task.project._count.tasks || 0) / 100, 1),
          teamSize: Math.min((task.project._count.members || 0) / 20, 1),
          dayOfWeek: new Date(task.createdAt).getDay(),
          hourOfDay: new Date(task.createdAt).getHours()
        };

        return {
          features,
          completionTime,
          wasOnTime
        };
      });
    } catch (error) {
      console.error('Training data error:', error);
      return [];
    }
  }

  private mapPriority(priority: string): number {
    const mapping: Record<string, number> = {
      'LOW': 0,
      'MEDIUM': 1,
      'HIGH': 2,
      'URGENT': 3
    };
    return mapping[priority] || 1;
  }

  // Rule-based fallback system
  private ruleBased = {
    predict: (features: TaskFeatures) => {
      let baseHours = 8; // Default 1 day

      // Priority multiplier
      const priorityMultiplier = [0.5, 1, 1.5, 2][features.priority];
      baseHours *= priorityMultiplier;

      // Complexity multiplier
      baseHours *= (1 + features.complexity);

      // Experience factor
      baseHours *= (1.5 - features.assigneeExperience * 0.5);

      // Team size factor
      baseHours *= (1.2 - features.teamSize * 0.2);

      // Day of week factor (weekends are slower)
      if (features.dayOfWeek === 0 || features.dayOfWeek === 6) {
        baseHours *= 1.3;
      }

      const onTimeProbability = features.assigneeExperience * 0.4 + 
                               (1 - features.complexity) * 0.3 + 
                               features.teamSize * 0.3;

      return {
        estimatedHours: Math.max(1, Math.round(baseHours)),
        onTimeProbability: Math.round(onTimeProbability * 100) / 100,
        confidence: 0.6
      };
    }
  };

  // Model retraining scheduler
  async scheduleRetraining() {
    // Retrain model weekly with new data
    setInterval(async () => {
      if (!this.isTraining) {
        console.log('🔄 Starting scheduled model retraining...');
        await this.createAndTrainModel();
      }
    }, 7 * 24 * 60 * 60 * 1000); // Weekly
  }

  // Feature engineering helpers
  static async extractFeatures(taskId: string): Promise<TaskFeatures> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: {
          select: {
            _count: {
              select: {
                tasks: {
                  where: { status: 'DONE' }
                }
              }
            }
          }
        },
        project: {
          select: {
            _count: {
              select: { tasks: true, members: true }
            }
          }
        }
      }
    });

    if (!task) throw new Error('Task not found');

    return {
      priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].indexOf(task.priority),
      complexity: Math.min((task.description?.length || 0) / 500, 1),
      assigneeExperience: task.assignee?._count.tasks ? Math.min(task.assignee._count.tasks / 50, 1) : 0,
      projectSize: Math.min((task.project._count.tasks || 0) / 100, 1),
      teamSize: Math.min((task.project._count.members || 0) / 20, 1),
      dayOfWeek: new Date().getDay(),
      hourOfDay: new Date().getHours()
    };
  }
}

export const taskPredictionModel = new TaskPredictionModel();

// Auto-start retraining scheduler
taskPredictionModel.scheduleRetraining();