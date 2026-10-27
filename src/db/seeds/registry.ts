import type { PoolClient } from "pg";

export type Seed = {
  name: string;
  dependencies?: string[];
  run: (context: { db: PoolClient }) => Promise<void>;
};

export const seeds: Seed[] = [
  {
    name: "users",
    async run({ db }) {
      await db.query(`INSERT INTO users (firebase_uid, email, display_name)
      VALUES ('seed-user-alex', 'alex@example.test', 'Alex Example'),
             ('seed-user-sam', 'sam@example.test', 'Sam Example')
      ON CONFLICT (firebase_uid) DO NOTHING`);
    },
  },
];

export function selectSeeds(
  registry: Seed[],
  names = registry.map((seed) => seed.name),
) {
  const selected: Seed[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error("Seed dependency cycle.");
    const seed = registry.find((candidate) => candidate.name === name);
    if (!seed) throw new Error("Unknown seed name.");
    visiting.add(name);
    seed.dependencies?.forEach(visit);
    visiting.delete(name);
    visited.add(name);
    selected.push(seed);
  }
  names.forEach(visit);
  return selected;
}

export async function runSeeds(
  db: PoolClient,
  selected: Seed[],
  completed: (name: string) => void = () => {},
) {
  for (const seed of selected) {
    await db.query("BEGIN");
    try {
      await seed.run({ db });
      await db.query("COMMIT");
      completed(seed.name);
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }
}
