/**
 * Browser globals that pdf.js expects to exist.
 *
 * pdf-parse v2 is built on pdfjs-dist, which is written for the browser and
 * reaches for DOMMatrix, Path2D and ImageData while its module is still
 * loading. In Node none of those exist, so the import throws
 * "DOMMatrix is not defined" before a single page is read — which is exactly
 * what the Knowledge page reported on every PDF upload.
 *
 * Text extraction never touches these: they belong to the canvas rendering
 * path, which server-side parsing does not use. Minimal stubs are enough to
 * get the module loaded, and are only installed when genuinely absent, so a
 * runtime that does provide them (or a future Node that does) is untouched.
 */

/** Deliberately `unknown`-typed: these are stubs, not faithful
 *  implementations, and asserting they satisfy the full DOM interfaces would
 *  be a lie that TypeScript is right to reject. */
type G = Record<string, unknown>;

export function installPdfGlobals(): void {
  const g = globalThis as unknown as G;

  if (typeof g.DOMMatrix === "undefined") {
    class DOMMatrixStub {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m21 = 0; m22 = 1; m41 = 0; m42 = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
          this.m11 = this.a; this.m12 = this.b;
          this.m21 = this.c; this.m22 = this.d;
          this.m41 = this.e; this.m42 = this.f;
        }
      }
      // Identity behaviour is correct here: nothing in the text path composes
      // matrices, and returning `this` keeps any chained call harmless.
      multiply() { return this; }
      translate() { return this; }
      scale() { return this; }
      inverse() { return this; }
      toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
    }
    g.DOMMatrix = DOMMatrixStub;
  }

  if (typeof g.Path2D === "undefined") {
    class Path2DStub {
      addPath() {} closePath() {} moveTo() {} lineTo() {}
      bezierCurveTo() {} quadraticCurveTo() {} arc() {} rect() {}
    }
    g.Path2D = Path2DStub;
  }

  if (typeof g.ImageData === "undefined") {
    class ImageDataStub {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(Math.max(0, width * height * 4));
      }
    }
    g.ImageData = ImageDataStub;
  }
}
