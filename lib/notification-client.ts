import { useBabyStore } from "@/stores/useBabyStore";
import type { NotificationIdentity } from "./notification-actions";
export function currentNotificationIdentity(): NotificationIdentity | null {
  const { user, family, baby, selectedBabyId } = useBabyStore.getState();
  if (!user?.id || !baby?.id || !family?.id || baby.familyId !== family.id || selectedBabyId !== baby.id) return null;
  return { userId: user.id, familyId: family.id, babyId: baby.id };
}
