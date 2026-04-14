type DataLayerEvent = {
    event: string;
    [key: string]: unknown;
};

export {};

declare global {
    interface Window {
        dataLayer: DataLayerEvent[];
        gtag?: (...args: unknown[]) => void;
    }
}
