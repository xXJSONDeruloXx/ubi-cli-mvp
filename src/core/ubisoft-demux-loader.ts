import { existsSync } from 'node:fs';
import path from 'node:path';
import protobuf from 'protobufjs';
import type * as UbisoftDemuxModule from 'ubisoft-demux';

let patched = false;

function patchResolvePath(): void {
  if (patched) {
    return;
  }

  patched = true;
  const packageProtoRoot = path.join(
    process.cwd(),
    'node_modules/ubisoft-demux/dist/proto'
  );
  const originalResolvePath = Object.getOwnPropertyDescriptor(
    protobuf.Root.prototype,
    'resolvePath'
  )?.value as
    | ((this: protobuf.Root, origin: string, target: string) => string | null)
    | undefined;

  protobuf.Root.prototype.resolvePath = function resolvePath(
    origin: string,
    target: string
  ): string {
    if (!target.startsWith('.') && !path.isAbsolute(target)) {
      const candidate = path.join(packageProtoRoot, target);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return originalResolvePath?.call(this, origin, target) ?? target;
  };
}

export async function loadUbisoftDemuxModule(): Promise<
  typeof UbisoftDemuxModule
> {
  patchResolvePath();
  return import('ubisoft-demux');
}
