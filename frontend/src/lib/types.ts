export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  familyId: string;
  memberId: string | null;
};
export type Family = { id: string; name: string; baseCurrency: string };
export type Me = { user: AuthUser; family: Family };
export type Member = { id: string; name: string; isUser: boolean };
