export type Anchor = {
    kind: "tty";
    tty: string;
} | {
    kind: "pid";
    pid: number;
    label?: string;
};
export declare function socketDir(): string;
export declare function socketPathFor(anchor: Anchor): string;
export declare function anchorFromEnv(): Anchor | null;
