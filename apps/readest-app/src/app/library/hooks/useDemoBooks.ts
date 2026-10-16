import { useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { Book } from '@/types/book';
import { getUserLang } from '@/utils/misc';
import { isWebAppPlatform } from '@/services/environment';
import { demoLibraries as libraries } from '@/services/demoBooks';

interface DemoBooks {
  library: string[];
}

export const useDemoBooks = () => {
  const { envConfig } = useEnv();
  const [books, setBooks] = useState<Book[]>([]);
  const isLoading = useRef(false);

  useEffect(() => {
    if (isLoading.current) return;
    isLoading.current = true;

    const userLang = getUserLang() as keyof typeof libraries;
    const fetchDemoBooks = async () => {
      try {
        const appService = await envConfig.getAppService();
        const demoBooks = libraries[userLang] || (libraries.en as DemoBooks);
        const books = await Promise.all(
          demoBooks.library.map((url) => appService.importBook(url, [], { saveBook: false })),
        );
        // Stamp the rows as the sample shelf they are: `isDemoBook()` and every
        // guard built on it read this flag, and it must be set before the page
        // merges them into the library (see demoBooks.ts).
        setBooks(
          (books.filter((book) => book !== null) as Book[]).map((book) => ({
            ...book,
            isDemo: true,
          })),
        );
      } catch (error) {
        console.error('Failed to import demo books:', error);
      }
    };

    const demoBooksFetchedFlag = localStorage.getItem('demoBooksFetched');
    if (isWebAppPlatform() && !demoBooksFetchedFlag) {
      fetchDemoBooks();
      localStorage.setItem('demoBooksFetched', 'true');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return books;
};
