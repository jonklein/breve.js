# Makes beetle.glb: a body and a head, as one mesh (positions, normals, triangles), with no libraries.
# Any glTF/GLB file works in its place; scene.json's `visual` says which one a part draws and how to scale it.
import json, math, struct

def ellipsoid(center, radii, rings=14, sectors=20):
    """Vertices (position, normal) and triangle indices for a squashed sphere."""
    verts, idx = [], []
    for r in range(rings + 1):
        phi = math.pi * r / rings
        for s in range(sectors + 1):
            th = 2 * math.pi * s / sectors
            nx, ny, nz = math.sin(phi) * math.cos(th), math.cos(phi), math.sin(phi) * math.sin(th)
            pos = (center[0] + radii[0] * nx, center[1] + radii[1] * ny, center[2] + radii[2] * nz)
            # the normal of a squashed sphere is the unit sphere's normal divided by the radii
            n = (nx / radii[0], ny / radii[1], nz / radii[2]); l = math.sqrt(sum(c * c for c in n)) or 1
            verts.append((pos, tuple(c / l for c in n)))
    for r in range(rings):
        for s in range(sectors):
            a = r * (sectors + 1) + s; b = a + sectors + 1
            idx += [a, b, a + 1, a + 1, b, b + 1]
    return verts, idx

body_v, body_i = ellipsoid((0, 0, 0), (0.5, 0.17, 0.27))
head_v, head_i = ellipsoid((0.5, 0.0, 0), (0.15, 0.11, 0.13), 10, 14)
verts = body_v + head_v
idx = body_i + [i + len(body_v) for i in head_i]

pos = b''.join(struct.pack('<3f', *v[0]) for v in verts)
nrm = b''.join(struct.pack('<3f', *v[1]) for v in verts)
ind = b''.join(struct.pack('<H', i) for i in idx)
ind += b'\0' * (-len(ind) % 4)
blob = pos + nrm + ind
mins = [min(v[0][k] for v in verts) for k in range(3)]
maxs = [max(v[0][k] for v in verts) for k in range(3)]
doc = {
    'asset': {'version': '2.0', 'generator': 'make_beetle.py'},
    'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'beetle'}],
    'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1}, 'indices': 2}]}],
    'accessors': [
        {'bufferView': 0, 'componentType': 5126, 'count': len(verts), 'type': 'VEC3', 'min': mins, 'max': maxs},
        {'bufferView': 1, 'componentType': 5126, 'count': len(verts), 'type': 'VEC3'},
        {'bufferView': 2, 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'},
    ],
    'bufferViews': [
        {'buffer': 0, 'byteOffset': 0, 'byteLength': len(pos), 'target': 34962},
        {'buffer': 0, 'byteOffset': len(pos), 'byteLength': len(nrm), 'target': 34962},
        {'buffer': 0, 'byteOffset': len(pos) + len(nrm), 'byteLength': len(idx) * 2, 'target': 34963},
    ],
    'buffers': [{'byteLength': len(blob)}],
}
js = json.dumps(doc, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
glb += struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(blob), b'BIN\0') + blob
open('beetle.glb', 'wb').write(glb)
print('beetle.glb', len(glb), 'bytes,', len(verts), 'vertices')
