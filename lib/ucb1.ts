export interface UCB1Arm {
  id: number;
  meanReward: number;
  visits: number;
  weekIndex: number;
  weekStartDate: Date;
}

export interface WeeklyYieldData {
  weekIndex: number;
  weekStartDate: Date;
  bestYield: number;
  sampleCount: number;
}

export class UCB1 {
  private arms: UCB1Arm[];
  private totalVisits: number;
  private explorationConstant: number;

  constructor(weekCount: number, weekStarts: Date[], explorationConstant: number = 2.0) {
    this.arms = weekStarts.map((weekStart, index) => ({
      id: index,
      meanReward: 0,
      visits: 0,
      weekIndex: index,
      weekStartDate: weekStart,
    }));
    this.totalVisits = 0;
    this.explorationConstant = explorationConstant;
  }

  seedWithPriors(priors: WeeklyYieldData[]): void {
    for (const prior of priors) {
      const arm = this.arms.find(a => a.weekIndex === prior.weekIndex);
      if (arm) {
        arm.meanReward = prior.bestYield;
        arm.visits = prior.sampleCount;
        this.totalVisits += prior.sampleCount;
      }
    }
  }

  select(c: number = this.explorationConstant): UCB1Arm {
    if (this.totalVisits === 0) {
      const randomIndex = Math.floor(Math.random() * this.arms.length);
      return this.arms[randomIndex];
    }

    let bestArm: UCB1Arm | null = null;
    let bestUCB = -Infinity;

    for (const arm of this.arms) {
      const explorationBonus = c * Math.sqrt(Math.log(this.totalVisits) / (arm.visits + 1));
      const ucb = arm.meanReward + explorationBonus;

      if (ucb > bestUCB) {
        bestUCB = ucb;
        bestArm = arm;
      }
    }

    return bestArm || this.arms[0];
  }

  update(armIndex: number, yieldData: WeeklyYieldData): void {
    const arm = this.arms[armIndex];
    if (!arm) return;

    const newVisits = arm.visits + yieldData.sampleCount;
    arm.meanReward = (arm.meanReward * arm.visits + yieldData.bestYield * yieldData.sampleCount) / newVisits;
    arm.visits = newVisits;
    this.totalVisits += yieldData.sampleCount;
  }

  getArmStats(): { weekIndex: number; weekStartDate: Date; meanReward: number; visits: number; ucb: number }[] {
    return this.arms.map(arm => {
      const explorationBonus = this.explorationConstant * Math.sqrt(
        Math.log(this.totalVisits || 1) / (arm.visits + 1)
      );
      return {
        weekIndex: arm.weekIndex,
        weekStartDate: arm.weekStartDate,
        meanReward: arm.meanReward,
        visits: arm.visits,
        ucb: arm.meanReward + explorationBonus,
      };
    });
  }

  getTopArms(count: number): UCB1Arm[] {
    return [...this.arms]
      .sort((a, b) => a.meanReward - b.meanReward)
      .slice(0, count);
  }

  getArmCount(): number {
    return this.arms.length;
  }
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function microBatch<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const chunks = chunkArray(items, batchSize);

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(processor));
    results.push(...chunkResults);
    if (delayMs > 0 && chunks.indexOf(chunk) < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
