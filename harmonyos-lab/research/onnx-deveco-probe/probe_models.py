#!/usr/bin/env python3
"""Print ONNX graph I/O metadata for DevEco downloaded models."""

from __future__ import annotations

import sys

import onnx
from onnx import TensorProto

from model_paths import check_paths, resolve_paths

def _elem_type_name(elem_type: int) -> str:
    return TensorProto.DataType.Name(elem_type)


def _format_dim(dim) -> str:
    if dim.dim_param:
        return dim.dim_param
    if dim.dim_value:
        return str(dim.dim_value)
    return "?"


def _format_shape(tensor_type) -> str:
    if not tensor_type.HasField("shape"):
        return "?"
    dims = [_format_dim(d) for d in tensor_type.shape.dim]
    return "[" + ", ".join(dims) + "]"


def describe_model(name: str, path) -> None:
    print(f"\n{'=' * 72}")
    print(f"Model: {name}")
    print(f"Path:  {path}")
    print(f"Size:  {path.stat().st_size / (1024 * 1024):.2f} MiB")

    model = onnx.load(str(path), load_external_data=False)
    graph = model.graph
    print(f"IR version: {model.ir_version}")
    opsets = [f"{o.domain or 'ai.onnx'}:{o.version}" for o in model.opset_import]
    print(f"Opset: {opsets}")

    print("\n--- Inputs ---")
    for inp in graph.input:
        tt = inp.type.tensor_type
        print(
            f"  {inp.name}: {_elem_type_name(tt.elem_type)} "
            f"shape={_format_shape(tt)}"
        )

    print("\n--- Outputs ---")
    for out in graph.output:
        tt = out.type.tensor_type
        print(
            f"  {out.name}: {_elem_type_name(tt.elem_type)} "
            f"shape={_format_shape(tt)}"
        )

    # Initializers count (weights)
    inits = list(graph.initializer)
    print(f"\n--- Initializers (weights): {len(inits)} ---")
    if inits:
        total = sum(i.raw_data.__len__() if i.raw_data else 0 for i in inits[:5])
        print(f"  (showing first 5 names; total initializer tensors: {len(inits)})")
        for init in inits[:5]:
            shape = list(init.dims)
            print(f"  {init.name}: shape={shape}")

    print(f"\n--- Node count: {len(graph.node)} ---")


def main() -> int:
    paths = resolve_paths()
    missing = check_paths(paths)
    if missing:
        print("Missing model files (run DevEco 应用探索测试 to download first):", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        return 1

    for key, p in paths.items():
        describe_model(key, p)

    print("\nDone. Use smoke_inference.py for a random-tensor forward pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
