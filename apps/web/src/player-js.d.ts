declare module "player.js" {
  interface PlayerEventMap {
    ready: undefined;
    play: undefined;
    pause: undefined;
    ended: undefined;
    error: unknown;
    timeupdate: { seconds: number; duration: number };
  }

  interface PlayerInstance {
    on<K extends keyof PlayerEventMap>(event: K, callback: (value: PlayerEventMap[K]) => void): void;
    off<K extends keyof PlayerEventMap>(event: K, callback?: (value: PlayerEventMap[K]) => void): void;
    pause(): void;
  }

  const playerjs: {
    Player: new (element: HTMLIFrameElement | string) => PlayerInstance;
  };
  export default playerjs;
}
