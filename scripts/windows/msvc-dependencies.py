"""Keep localized MSVC /showIncludes output readable by Ninja (UTF-8)."""
from pathlib import Path
import re
import subprocess
import sys

build = Path(sys.argv[1]).resolve()
root = build / 'include-probe'
root.mkdir(parents=True, exist_ok=True)
header = root / 'include-probe.hpp'
source = root / 'include-probe.cpp'
header.write_text('#pragma once\n', encoding='ascii')
source.write_text('#include "' + header.as_posix() + '"\n', encoding='utf-8')
result = subprocess.run(['cl.exe', '/nologo', '/showIncludes', '/EP', '/TP', str(source)], capture_output=True, check=True)
match = re.search(rb'(?m)^([^\r\n]*?)[A-Za-z]:[\\/][^\r\n]*include-probe\.hpp', result.stdout + b'\n' + result.stderr)
if not match:
    raise RuntimeError('MSVC include dependency prefix was not found')
prefix = (match[1].rstrip().decode('mbcs') + ' ').encode('utf-8')
if not prefix or b'\n' in prefix or b']=]' in prefix:
    raise RuntimeError('Invalid MSVC dependency prefix')
settings = b''.join(b'set(' + name + b' [=[' + prefix + b']=])\n' for name in
    (b'CMAKE_CL_SHOWINCLUDES_PREFIX', b'CMAKE_C_CL_SHOWINCLUDES_PREFIX', b'CMAKE_CXX_CL_SHOWINCLUDES_PREFIX'))
target = root / 'msvc-dependencies.cmake'
if not target.exists() or target.read_bytes() != settings:
    target.write_bytes(settings)
for name in ('CMakeCCompiler.cmake', 'CMakeCXXCompiler.cmake'):
    for cached in (build / 'CMakeFiles').glob('*/' + name):
        before = cached.read_bytes()
        after = re.sub(rb'set\((CMAKE_(?:C|CXX)_CL_SHOWINCLUDES_PREFIX) [^\r\n]*\)',
            lambda m: b'set(' + m[1] + b' [=[' + prefix + b']=])', before)
        if after != before:
            cached.write_bytes(after)
