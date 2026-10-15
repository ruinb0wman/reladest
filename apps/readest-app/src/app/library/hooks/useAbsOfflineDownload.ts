import { useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { isAbsOfflineAllowed } from '@/utils/access';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import type { Book } from '@/types/book';

/**
 * "Download for Offline" on an Audiobookshelf book (#6256), a premium feature:
 * entitled users queue the download, everyone else is routed to the upgrade
 * page (or sign-in). Mirrors the offline TTS-audio gate in TTSPlayerSheet.
 */
export const useAbsOfflineDownload = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const entitled = isAbsOfflineAllowed(userProfilePlan ?? 'free', customizationPurchased);
  // Only badge users who can't use it yet: signed out, or a resolved plan
  // without the feature — never an entitled user whose plan is still loading.
  const offlinePremiumLabel =
    !entitled && (!user || userProfilePlan !== undefined) ? _('Premium') : undefined;

  const handleBooksOfflineDownload = useCallback(
    (_books: Book[]) => {
      // The download itself ran through the cloud transfer queue, which is gone
      // with the audiobook feature this gates. The gate stays until then so the
      // Premium badge and the sign-in fallback keep their meaning.
      if (entitled) {
      } else if (user) {
        navigateToProfile(router);
      } else {
        navigateToLogin(router);
      }
    },
    [entitled, user, router],
  );
  const handleBookOfflineDownload = useCallback(
    (book: Book) => handleBooksOfflineDownload([book]),
    [handleBooksOfflineDownload],
  );

  return { handleBookOfflineDownload, handleBooksOfflineDownload, offlinePremiumLabel };
};
