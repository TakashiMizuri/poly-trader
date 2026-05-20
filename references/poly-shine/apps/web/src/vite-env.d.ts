/// <reference types="vite/client" />

declare module "@fontsource-variable/geist";
declare module "@fontsource-variable/geist-mono";

interface ImportMetaEnv {
  readonly VITE_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
