#!/usr/bin/env python3
"""motion-mcp baking pipeline CLI.

Subcommands:
  reduce      Reduce + quantize a MotionDoc JSON in place (writes new file)
  info        Print keyframe counts / metadata for a MotionDoc
  from-ardy   Convert an ARDY .npz output into a MotionDoc skeleton stub
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bake import bake_library, count_keys, process_doc  # noqa: E402


def _read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, separators=(",", ":"))
        handle.write("\n")


def cmd_reduce(args):
    doc = process_doc(_read_json(args.input), eps=args.eps)
    if args.fps:
        doc["fps"] = args.fps
    _write_json(args.output, doc)
    print(f"{args.input} -> {args.output}: {count_keys(doc)} keys kept")


def cmd_info(args):
    doc = _read_json(args.input)
    print(f"id={doc.get('id')} durationMs={doc.get('durationMs')} loop={doc.get('loop')}")
    print(f"tracks={len(doc.get('tracks', {}))} totalKeys={count_keys(doc)}")
    print(f"meta={json.dumps(doc.get('meta', {}))}")


def cmd_from_ardy(args):
    from ardy_source import doc_from_npz

    doc = doc_from_npz(args.npz, args.joint_map)
    _write_json(args.output, doc)
    print(f"wrote {args.output} (retarget pending: {doc['meta']['retarget']})")


def cmd_bake_library(args):
    manifest = bake_library(args.input, args.output, eps=args.eps)
    print(f"baked {len(manifest['clips'])} clips -> {args.output}/library.json")


def main():
    parser = argparse.ArgumentParser(prog="pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    p_reduce = sub.add_parser("reduce", help="reduce + quantize MotionDoc")
    p_reduce.add_argument("input")
    p_reduce.add_argument("-o", "--output", required=True)
    p_reduce.add_argument("--eps", type=float, default=0.4)
    p_reduce.add_argument("--fps", type=int, default=None)
    p_reduce.set_defaults(func=cmd_reduce)

    p_info = sub.add_parser("info", help="inspect MotionDoc")
    p_info.add_argument("input")
    p_info.set_defaults(func=cmd_info)

    p_ardy = sub.add_parser("from-ardy", help="ARDY npz -> MotionDoc stub")
    p_ardy.add_argument("npz")
    p_ardy.add_argument("--joint-map", required=True)
    p_ardy.add_argument("-o", "--output", required=True)
    p_ardy.set_defaults(func=cmd_from_ardy)

    p_lib = sub.add_parser("bake-library", help="batch bake a folder of MotionDocs")
    p_lib.add_argument("input")
    p_lib.add_argument("-o", "--output", required=True)
    p_lib.add_argument("--eps", type=float, default=0.4)
    p_lib.set_defaults(func=cmd_bake_library)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
