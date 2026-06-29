// Minimal ambient types for @dhis2/maps-gl, which ships no type definitions.
// Covers only the surface this app uses (Map class + createLayer/addControl).
declare module '@dhis2/maps-gl' {
  export interface D2Layer {
    addTo(map: D2MapInstance): void;
    removeFrom?(map: D2MapInstance): void;
    setIndex?(index: number): void;
    on?(event: string, cb: (...args: any[]) => void): void;
  }

  export interface D2MapInstance {
    createLayer(config: Record<string, any>): D2Layer;
    addControl(control: any): void;
    removeControl(control: any): void;
    on(event: string, cb: (...args: any[]) => void): void;
    off(event: string, cb: (...args: any[]) => void): void;
    fitBounds(bounds: [[number, number], [number, number]], opts?: Record<string, any>): void;
    setView(center: [number, number], zoom?: number): void;
    getZoom(): number;
    resize(): void;
    remove(): void;
    styleIsLoaded(): boolean;
    getMapGL(): any;
  }

  export const layerTypes: string[];
  export const controlTypes: string[];

  export default class Map implements D2MapInstance {
    constructor(el: HTMLElement, options?: Record<string, any>);
    createLayer(config: Record<string, any>): D2Layer;
    addControl(control: any): void;
    removeControl(control: any): void;
    on(event: string, cb: (...args: any[]) => void): void;
    off(event: string, cb: (...args: any[]) => void): void;
    fitBounds(bounds: [[number, number], [number, number]], opts?: Record<string, any>): void;
    setView(center: [number, number], zoom?: number): void;
    getZoom(): number;
    resize(): void;
    remove(): void;
    styleIsLoaded(): boolean;
    getMapGL(): any;
  }
}
