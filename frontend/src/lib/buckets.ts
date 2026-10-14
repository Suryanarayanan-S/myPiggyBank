import { useMe } from '../auth/auth';
import type { Bucket } from './types';

export type BucketNames = Record<Bucket, string>;

/** Names a new family starts with; each family can rename its buckets in Settings. */
export const DEFAULT_BUCKET_NAMES: BucketNames = {
  essentials: 'Keep Me Alive',
  fun: 'Make Me Happy',
  future: 'Make Me Rich',
};

/** What this family calls its three buckets. */
export function useBucketNames(): BucketNames {
  return useMe().data?.family.bucketNames ?? DEFAULT_BUCKET_NAMES;
}
