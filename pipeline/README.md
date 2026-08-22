# Offline Baking Pipeline

Python-side batch pipeline that turns generated/authored motion into
`@motion-mcp/motion-runtime` clips. Runs on any machine — including this Mac —
because generation happens offline; devices only ever play baked clips.

## Layout

```
pipeline/
  motiondoc.py    interchange format (mirrors the runtime's MotionClip)
  bake.py         Ramer-Douglas-Peucker keyframe reduction + quantization
  retarget.py     world positions -> hierarchical Euler XYZ (FK + inverse)
  ardy_source.py  nv-tlabs/ardy .npz adapter (numpy guarded import)
  cli.py          reduce / info / from-ardy commands
  maps/           humanoid.json rig spec; core-to-humanoid template (post-checkpoint)
  scripts/        fixture exporters
  tests/          stdlib unittest suite
```

## Retargeting guarantees (read before trusting output)

`solve_local_rotations` steers each joint toward its **primary child**. That is
**exact on pure chains** (verified to <1e-6) and only **bounded on branching
rigs** — a root with spine+thighs, or a chest with neck+arms, cannot satisfy all
children simultaneously when descendants rotate independently. This path exists
as the fallback for position-only sources. The primary ARDY path will convert
the checkpoint's own global-rotation outputs into humanoid-local rotations,
which sidesteps the ambiguity entirely; the joint-map in `maps/` unlocks it.

## Run the tests

```bash
python3 -m unittest discover -s pipeline/tests -v
```

## Bake a fixture

```bash
python3 pipeline/scripts/export_procedural_squat.py
# -> packages/motion-runtime/fixtures/squat.{source,baked}.json
```

## Wiring ARDY (nv-tlabs/ardy) on Apple Silicon

1. Request access once: https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct
   then `pip install -U huggingface_hub && hf auth login`.
2. Create an env and install ARDY without TensorRT extras:

```bash
python3 -m venv ~/.venvs/ardy && source ~/.venvs/ardy/bin/activate
pip install torch torchvision            # MPS-capable build
git clone https://github.com/nv-tlabs/ardy.git ~/Developer/ardy
pip install -e ~/Developer/ardy           # builds the C++ correction ext; needs cmake
```

3. Generate (CPU/MPS is slow — expect minutes per clip; batch overnight):

```bash
python ~/Developer/ardy/scripts/generate.py \
  "A person performs a slow bodyweight squat, hip hinge, upright torso." \
  --model core --duration 6.0 --seed 7 --output squat
```

4. Convert + retarget:

```bash
python pipeline/cli.py from-ardy outputs/squat.npz \
  --joint-map pipeline/maps/core-to-humanoid.json -o baked/squat.json
```

`core-to-humanoid.json` lands after the first checkpoint inspection confirms the
core skeleton's joint ordering. Until then `from-ardy` emits a stub carrying the
raw root path so plumbing can be exercised end to end.

## Notes

- The runtime loader (`@motion-mcp/motion-runtime` `clipFromMotionDoc`) consumes
  baked JSON directly; nothing device-side knows where a clip came from.
- Keep clips small: reduction typically drops 40-60% of authored keys with
  imperceptible error at eps=0.4.
