import { pathToFileURL } from "node:url";
import { run } from "./app/run";

// 直接実行時のみ CLI を起動し、テスト import 時は副作用を起こさない。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    // Error 型なら message を優先し、それ以外は文字列化して表示する。
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}
