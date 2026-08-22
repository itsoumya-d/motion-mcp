"""MotionDoc: the neutral interchange format between generation sources and motion-runtime.

Shape mirrors @motion-mcp/motion-runtime's MotionClip exactly:
  tracks[joint]      -> [[tMs, xDeg, yDeg, zDeg], ...]
  translations[root] -> [[tMs, xM, yM, zM], ...]
"""

FORMAT_ID = "motion-mcp.motiondoc"
VERSION = 1


def new_doc(doc_id: str, duration_ms: int, loop: bool, meta=None):
    return {
        "format": FORMAT_ID,
        "version": VERSION,
        "id": doc_id,
        "fps": None,
        "durationMs": duration_ms,
        "loop": loop,
        "meta": meta or {"source": "procedural"},
        "tracks": {},
        "translations": {},
    }


def add_track(doc, joint: str, keys):
    doc["tracks"][joint] = sorted(([float(k[0]), float(k[1]), float(k[2]), float(k[3])] for k in keys), key=lambda k: k[0])


def add_translation(doc, joint: str, keys):
    doc.setdefault("translations", {})[joint] = sorted(
        ([float(k[0]), float(k[1]), float(k[2]), float(k[3])] for k in keys), key=lambda k: k[0]
    )
