import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bake import count_keys, process_doc, quantize_track, reduce_track  # noqa: E402
from motiondoc import add_track, new_doc  # noqa: E402


class ReduceTest(unittest.TestCase):
    def test_redundant_collinear_keys_are_dropped(self):
        keys = [
            [0, 0, 0, 0],
            [400, 10, 0, 0],
            [800, 20, 0, 0],
            [1200, 30, 0, 0],
            [1600, 40, 0, 0],
        ]
        reduced = reduce_track(keys, eps=0.4)
        self.assertEqual(reduced[0], keys[0])
        self.assertEqual(reduced[-1], keys[-1])
        self.assertLess(len(reduced), len(keys))

    def test_curved_track_keeps_extremes(self):
        keys = [[0, 0, 0, 0], [500, 60, 0, 0], [1000, 90, 0, 0], [2000, 0, 0, 0]]
        reduced = reduce_track(keys, eps=0.4)
        kept_times = [k[0] for k in reduced]
        self.assertIn(500, kept_times)
        self.assertIn(1000, kept_times)

    def test_two_key_tracks_pass_through(self):
        keys = [[0, 5, 0, 0], [1000, -5, 0, 0]]
        self.assertEqual(reduce_track(keys), keys)


class QuantizeTest(unittest.TestCase):
    def test_angles_round_to_step_and_merge(self):
        out = quantize_track([[12, 10.03, 0, 0], [14, 10.04, 0, 0], [980, -20.02, 0, 0]], angle_step=0.05)
        self.assertEqual(out[0][0], 10)
        self.assertAlmostEqual(out[0][1], 10.05)
        self.assertEqual(len(out), 2, "identical adjacent poses after rounding must merge")

    def test_time_snap(self):
        out = quantize_track([[123, 1, 0, 0], [1277, 2, 0, 0]])
        self.assertEqual(out[0][0], 120)
        self.assertEqual(out[1][0], 1280)


class DocTest(unittest.TestCase):
    def test_process_doc_preserves_shape_and_shrinks_or_keeps(self):
        doc = new_doc("t", 1000, True)
        add_track(doc, "spine", [[0, 0, 0, 0], [500, 45, 0, 0], [1000, 0, 0, 0]])
        processed = process_doc(doc)
        self.assertEqual(processed["id"], "t")
        self.assertIn("spine", processed["tracks"])
        self.assertGreaterEqual(count_keys(processed), 2)

    def test_translation_dips_survive_reduction(self):
        from motiondoc import add_translation

        doc = new_doc("t", 2400, True)
        add_translation(doc, "root", [[0, 0, 0, 0], [900, 0, -0.34, 0], [1500, 0, -0.36, 0], [2400, 0, 0, 0]])
        processed = process_doc(doc)
        ys = [k[2] for k in processed["translations"]["root"]]
        self.assertTrue(any(y < -0.25 for y in ys), f"dip lost: {ys}")

    def test_bake_library_batches_and_manifests(self):
        import json
        import tempfile
        from pathlib import Path

        from bake import bake_library

        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src"
            out = Path(tmp) / "out"
            src.mkdir()
            for clip_id in ("squat", "lunge"):
                doc = new_doc(clip_id, 1000, True, meta={"exercise": clip_id})
                add_track(doc, "spine", [[0, 0, 0, 0], [500, 45, 0, 0], [1000, 0, 0, 0]])
                with open(src / f"{clip_id}.json", "w", encoding="utf-8") as handle:
                    json.dump(doc, handle)
            (src / "not-a-motiondoc.json").write_text('{"hello": true}', encoding="utf-8")

            manifest = bake_library(src, out)

            self.assertEqual(len(manifest["clips"]), 2, "non-MotionDoc files must be skipped")
            names = {entry["file"] for entry in manifest["clips"]}
            self.assertEqual(names, {"squat.baked.json", "lunge.baked.json"})
            self.assertTrue((out / "library.json").exists())
            baked = json.loads((out / "squat.baked.json").read_text(encoding="utf-8"))
            self.assertEqual(baked["meta"]["exercise"], "squat")


if __name__ == "__main__":
    unittest.main()
