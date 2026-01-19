import { promises as fs } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { DeliveryPlan, DeliveryPlanSchema } from '../types/index.js';

export class PlanStore {
  private plansDir: string;

  constructor() {
    this.plansDir = config.paths.plans;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.plansDir, { recursive: true });
  }

  private getFilePath(id: string): string {
    return join(this.plansDir, `${id}.json`);
  }

  async save(plan: DeliveryPlan): Promise<void> {
    const filePath = this.getFilePath(plan.id);
    await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');
  }

  async get(id: string): Promise<DeliveryPlan | null> {
    const filePath = this.getFilePath(id);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return DeliveryPlanSchema.parse(JSON.parse(content));
    } catch {
      return null;
    }
  }

  async list(): Promise<DeliveryPlan[]> {
    try {
      const files = await fs.readdir(this.plansDir);
      const plans: DeliveryPlan[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.plansDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const plan = DeliveryPlanSchema.parse(JSON.parse(content));
          plans.push(plan);
        } catch {
          // Skip invalid files
        }
      }

      // Sort by creation date (newest first)
      plans.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return plans;
    } catch {
      return [];
    }
  }

  async delete(id: string): Promise<boolean> {
    const filePath = this.getFilePath(id);

    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<number> {
    let deleted = 0;

    try {
      const files = await fs.readdir(this.plansDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        await fs.unlink(join(this.plansDir, file));
        deleted++;
      }
    } catch {
      // Ignore errors
    }

    return deleted;
  }
}

// Singleton instance
export const planStore = new PlanStore();
