"""Weryfikacja Ed25519 (RFC 8032) dla lokalnego serwera synchronizacji."""

import hashlib

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, P - 2, P)) % P
I = pow(2, (P - 1) // 4, P)
B_Y = (4 * pow(5, P - 2, P)) % P


def _sha512(data: bytes) -> bytes:
    return hashlib.sha512(data).digest()


def _inv(x: int) -> int:
    return pow(x, P - 2, P)


def _xrecover(y: int):
    y2 = (y * y) % P
    xx = ((y2 - 1) * _inv((D * y2 + 1) % P)) % P
    x = pow(xx, (P + 3) // 8, P)
    if (x * x - xx) % P != 0:
        x = (x * I) % P
    if (x * x - xx) % P != 0:
        return None
    if x & 1:
        x = P - x
    return x


def _decode_point(data: bytes):
    if len(data) != 32:
        return None
    raw = int.from_bytes(data, "little")
    sign = (raw >> 255) & 1
    y = raw & ((1 << 255) - 1)
    if y >= P:
        return None
    x = _xrecover(y)
    if x is None:
        return None
    if (x & 1) != sign:
        x = P - x
    # a = -1: -x² + y² = 1 + d x² y²
    if (-x * x + y * y - 1 - D * x * x * y * y) % P != 0:
        return None
    return x, y


def _encode_point(point) -> bytes:
    x, y = point
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def _edwards_add(p, q):
    x1, y1 = p
    x2, y2 = q
    den = (D * x1 * x2 * y1 * y2) % P
    x3 = ((x1 * y2 + x2 * y1) * _inv((1 + den) % P)) % P
    y3 = ((y1 * y2 + x1 * x2) * _inv((1 - den) % P)) % P
    return x3, y3


def _scalarmult(point, scalar: int):
    result = (0, 1)
    base = point
    while scalar:
        if scalar & 1:
            result = _edwards_add(result, base)
        base = _edwards_add(base, base)
        scalar >>= 1
    return result


B = (_xrecover(B_Y), B_Y)


def verify(public: bytes, signature: bytes, message: bytes) -> bool:
    if len(public) != 32 or len(signature) != 64:
        return False
    A = _decode_point(public)
    R = _decode_point(signature[:32])
    if A is None or R is None:
        return False
    S = int.from_bytes(signature[32:], "little")
    if S >= L:
        return False
    k = int.from_bytes(_sha512(signature[:32] + public + message), "little") % L
    left = _scalarmult(B, S)
    right = _edwards_add(R, _scalarmult(A, k))
    return left == right


def _clamp(seed: bytes):
    digest = _sha512(seed)
    a = int.from_bytes(digest[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, digest[32:]


def public_from_seed(seed: bytes) -> bytes:
    scalar, _prefix = _clamp(seed)
    return _encode_point(_scalarmult(B, scalar))


def sign(seed: bytes, message: bytes) -> bytes:
    scalar, prefix = _clamp(seed)
    public = _encode_point(_scalarmult(B, scalar))
    r = int.from_bytes(_sha512(prefix + message), "little") % L
    R = _encode_point(_scalarmult(B, r))
    k = int.from_bytes(_sha512(R + public + message), "little") % L
    S = (r + k * scalar) % L
    return R + S.to_bytes(32, "little")


if __name__ == "__main__":
    import sys

    ok = verify(bytes.fromhex(sys.argv[1]), bytes.fromhex(sys.argv[2]), sys.stdin.buffer.read())
    raise SystemExit(0 if ok else 1)
