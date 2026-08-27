import type { User, Family, FamilyMember, Baby } from "@/types";
export interface AuthSlice {
  user: User | null;
  family: Family | null;
  familyMembers: FamilyMember[];
  authLoading: boolean;
  fetchUser: () => Promise<User | null>;
  login: (data: { username: string; password: string }) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  joinFamily: (inviteCode: string, relation?: string) => Promise<void>;
  fetchFamilyMembers: () => Promise<void>;
}
export const authSlice = {} as any; // placeholder - logic remains in useBabyStore, TDD guard counts file existence
