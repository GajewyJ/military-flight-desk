import { useState, useCallback } from 'react';
import type { SaveDialogResult } from '../types/electronSim';

export function useSimConnect() {
  const isElectron = Boolean(typeof window !== 'undefined' && window.electronSim?.isElectron);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<SaveDialogResult | null>(null);

  const saveWithDialog = useCallback(
    async (
      defaultFilename: string,
      content: string,
      extension: string = 'pln',
      filterName: string = 'MSFS Flight Plan'
    ): Promise<SaveDialogResult> => {
      if (!window.electronSim) {
        return { canceled: true };
      }
      setIsSaving(true);
      try {
        const result = await window.electronSim.saveFileDialog(
          defaultFilename,
          content,
          extension,
          filterName
        );
        if (result.success) {
          setLastSaved(result);
        }
        return result;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const showInFolder = useCallback(async (filePath: string) => {
    if (!window.electronSim || !filePath) return;
    await window.electronSim.showItemInFolder(filePath);
  }, []);

  return {
    isElectron,
    isSaving,
    lastSaved,
    saveWithDialog,
    showInFolder,
  };
}
