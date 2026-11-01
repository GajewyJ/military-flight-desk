export interface SaveDialogResult {
  success?: boolean;
  canceled?: boolean;
  filePath?: string;
  filename?: string;
  error?: string;
}

export interface ElectronSimAPI {
  isElectron: boolean;
  saveFileDialog: (
    defaultFilename: string,
    content: string,
    extension?: string,
    filterName?: string
  ) => Promise<SaveDialogResult>;
  savePdfDialog: (
    defaultFilename: string,
    pdfBase64: string
  ) => Promise<SaveDialogResult>;
  showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronSim?: ElectronSimAPI;
  }
}
