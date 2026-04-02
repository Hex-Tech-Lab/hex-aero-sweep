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

export interface WeeklyRewardData {
  weekIndex: number;
  weekStartDate: Date;
  reward: number;
  sampleCount: number;
}

export class UCB1 {
  private arms: UCB1Arm[];
  private totalVisits: number;
  private explorationConstant: number;

  constructor(weekStarts: Date[], explorationConstant: number = 2.0) {
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
        arm.meanReward = -prior.bestYield;
        arm.visits = prior.sampleCount;
        this.totalVisits += prior.sampleCount;
      }
    }
  }

  select(c: number = this.explorationConstant): UCB1Arm {
    for (const arm of this.arms) {
      if (arm.visits === 0) {
        return arm;
      }
    }

    let bestArm: UCB1Arm | null = null;
    let bestUCB = Infinity;

    for (const arm of this.arms) {
      const explorationBonus = c * Math.sqrt(Math.log(this.totalVisits) / arm.visits);
      const ucb = arm.meanReward - explorationBonus;

      if (ucb < bestUCB) {
        bestUCB = ucb;
        bestArm = arm;
      }
    }

    return bestArm || this.arms[0];
  }

  update(armIndex: number, rewardData: WeeklyRewardData): void {
    const arm = this.arms[armIndex];
    if (!arm) return;

    const newVisits = arm.visits + rewardData.sampleCount;
    arm.meanReward = (arm.meanReward * arm.visits + rewardData.reward * rewardData.sampleCount) / newVisits;
    arm.visits = newVisits;
    this.totalVisits += rewardData.sampleCount;
  }

  getArmStats(): { weekIndex: number; weekStartDate: Date; meanReward: number; visits: number; ucb: number }[] {
    return this.arms.map(arm => {
      const explorationBonus = this.explorationConstant * Math.sqrt(
        Math.log(this.totalVisits || 1) / (arm.visits || 1)
      );
      return {
        weekIndex: arm.weekIndex,
        weekStartDate: arm.weekStartDate,
        meanReward: arm.meanReward,
        visits: arm.visits,
        ucb: arm.meanReward - explorationBonus,
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
  if (size < 1) throw new Error('chunkArray: size must be >= 1');
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
