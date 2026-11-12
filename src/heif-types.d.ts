declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    free(): void;
    display(
      pixels: {
        width: number;
        height: number;
        data: Uint8ClampedArray<ArrayBuffer>;
      },
      callback: (
        pixels: {
          width: number;
          height: number;
          data: Uint8ClampedArray<ArrayBuffer>;
        } | null,
      ) => void,
    ): void;
  }
  export default function createModule(): Promise<{
    HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
  }>;
}
