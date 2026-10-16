#!/usr/bin/env python3
"""Builds a macOS installer package (.pkg) for Lantern without a Mac.

A .pkg is a XAR archive holding a Distribution file and a component package (Bom, Payload,
PackageInfo, Scripts). Apple's pkgbuild/productbuild only run on macOS, so this writes the same
structure directly: the Payload and Scripts are gzip-compressed cpio (odc) archives, the Bom comes
from bomutils' mkbom, and the XAR container is written here.

Usage: make-pkg.py <Lantern.app> <output.pkg> <version> [--mkbom /path/to/mkbom]
"""
import gzip, hashlib, io, os, shutil, stat, subprocess, sys, tempfile, time, zlib
from xml.sax.saxutils import escape

APP_ID = "app.lantern.browser"


def cpio_odc(root, prefix="."):
    """A cpio archive in the portable 'odc' format with every entry owned by root:wheel."""
    out = io.BytesIO()
    ino = [0]

    def entry(name, mode, data=b"", mtime=0):
        ino[0] += 1
        nm = name.encode("utf-8") + b"\0"
        hdr = "070707%06o%06o%06o%06o%06o%06o%06o%011o%06o%011o" % (
            0, ino[0], mode, 0, 0, 1, 0, int(mtime), len(nm), len(data))
        out.write(hdr.encode("ascii") + nm + data)

    count = 0
    size = 0
    entry(prefix, stat.S_IFDIR | 0o755, mtime=time.time())
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        rel = os.path.relpath(dirpath, root)
        for name in sorted(dirnames) + sorted(filenames):
            full = os.path.join(dirpath, name)
            arc = prefix + "/" + (name if rel == "." else rel + "/" + name)
            st = os.lstat(full)
            if stat.S_ISLNK(st.st_mode):
                entry(arc, stat.S_IFLNK | 0o755, os.readlink(full).encode(), st.st_mtime)
            elif stat.S_ISDIR(st.st_mode):
                entry(arc, stat.S_IFDIR | 0o755, mtime=st.st_mtime)
            else:
                perm = 0o755 if st.st_mode & 0o111 else 0o644
                with open(full, "rb") as fh:
                    data = fh.read()
                entry(arc, stat.S_IFREG | perm, data, st.st_mtime)
                size += len(data)
            count += 1
    entry("TRAILER!!!", 0)
    return out.getvalue(), count + 1, size


def xar(entries):
    """Writes a XAR archive. entries: list of (path, bytes or None for a directory)."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    heap = io.BytesIO()
    heap.write(b"\0" * 20)  # the TOC checksum goes first
    tree = {}
    for path, data in entries:
        node = tree
        parts = path.split("/")
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        node[parts[-1]] = data if data is not None else node.get(parts[-1], {})

    next_id = [0]

    def emit(name, value, indent):
        next_id[0] += 1
        pad = "  " * indent
        x = [f'{pad}<file id="{next_id[0]}">']
        if isinstance(value, dict):
            x.append(f"{pad}  <type>directory</type><mode>0755</mode><uid>0</uid><gid>0</gid><user>root</user><group>wheel</group>")
            x.append(f"{pad}  <ctime>{now}</ctime><mtime>{now}</mtime><atime>{now}</atime>")
            x.append(f"{pad}  <name>{escape(name)}</name>")
            for k in value:
                x.extend(emit(k, value[k], indent + 1))
        else:
            off = heap.tell()
            heap.write(value)
            sha = hashlib.sha1(value).hexdigest()
            x.append(f"{pad}  <data><length>{len(value)}</length><offset>{off}</offset><size>{len(value)}</size>"
                     f'<encoding style="application/octet-stream"/>'
                     f'<extracted-checksum style="sha1">{sha}</extracted-checksum>'
                     f'<archived-checksum style="sha1">{sha}</archived-checksum></data>')
            x.append(f"{pad}  <type>file</type><mode>0644</mode><uid>0</uid><gid>0</gid><user>root</user><group>wheel</group>")
            x.append(f"{pad}  <ctime>{now}</ctime><mtime>{now}</mtime><atime>{now}</atime>")
            x.append(f"{pad}  <name>{escape(name)}</name>")
        x.append(f"{pad}</file>")
        return x

    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<xar>", " <toc>",
             '  <checksum style="sha1"><offset>0</offset><size>20</size></checksum>',
             f"  <creation-time>{now}</creation-time>"]
    for k in tree:
        lines.extend(emit(k, tree[k], 2))
    lines += [" </toc>", "</xar>"]
    toc = "\n".join(lines).encode("utf-8")
    ctoc = zlib.compress(toc, 9)
    heap_bytes = bytearray(heap.getvalue())
    heap_bytes[0:20] = hashlib.sha1(ctoc).digest()
    header = b"xar!" + (28).to_bytes(2, "big") + (1).to_bytes(2, "big") + len(ctoc).to_bytes(8, "big") \
        + len(toc).to_bytes(8, "big") + (1).to_bytes(4, "big")
    return header + ctoc + bytes(heap_bytes)


PREINSTALL = """#!/bin/sh
# Replace an older Lantern cleanly instead of layering new files over old ones.
# Only removes the bundle if it really is Lantern (app.lantern.browser). Your profiles, history,
# bookmarks and keys live in ~/Library/Application Support/Lantern and are not touched.
APP="$2/Lantern.app"
if [ -d "$APP" ] && /usr/bin/defaults read "$APP/Contents/Info" CFBundleIdentifier 2>/dev/null | grep -qx "app.lantern.browser"; then
  /usr/bin/pkill -x Lantern 2>/dev/null
  /bin/rm -rf "$APP"
fi
exit 0
"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    app, out, version = args[0], args[1], args[2]
    mkbom = sys.argv[sys.argv.index("--mkbom") + 1] if "--mkbom" in sys.argv else "mkbom"
    with tempfile.TemporaryDirectory() as tmp:
        root = os.path.join(tmp, "root")
        os.makedirs(root)
        shutil.copytree(app, os.path.join(root, "Lantern.app"), symlinks=True)
        payload, nfiles, nbytes = cpio_odc(root)
        bom = os.path.join(tmp, "Bom")
        subprocess.run([mkbom, "-u", "0", "-g", "0", root, bom], check=True)
        scripts_dir = os.path.join(tmp, "scripts")
        os.makedirs(scripts_dir)
        with open(os.path.join(scripts_dir, "preinstall"), "w") as fh:
            fh.write(PREINSTALL)
        os.chmod(os.path.join(scripts_dir, "preinstall"), 0o755)
        scripts, _, _ = cpio_odc(scripts_dir)
        kb = nbytes // 1024 + nfiles * 4
        pkginfo = f"""<?xml version="1.0" encoding="utf-8"?>
<pkg-info overwrite-permissions="true" relocatable="false" identifier="{APP_ID}" postinstall-action="none" version="{version}" format-version="2" generator-version="lantern-make-pkg" install-location="/Applications" auth="root">
    <payload numberOfFiles="{nfiles}" installKBytes="{kb}"/>
    <scripts>
        <preinstall file="./preinstall"/>
    </scripts>
    <bundle path="./Lantern.app" id="{APP_ID}" CFBundleShortVersionString="{version}" CFBundleVersion="{version}"/>
    <bundle-version>
        <bundle id="{APP_ID}"/>
    </bundle-version>
    <upgrade-bundle>
        <bundle id="{APP_ID}"/>
    </upgrade-bundle>
    <update-bundle/>
    <atomic-update-bundle/>
    <strict-identifier>
        <bundle id="{APP_ID}"/>
    </strict-identifier>
    <relocate/>
</pkg-info>
""".encode()
        distribution = f"""<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<installer-gui-script minSpecVersion="2">
    <title>Lantern {version}</title>
    <pkg-ref id="{APP_ID}">
        <bundle-version>
            <bundle CFBundleShortVersionString="{version}" CFBundleVersion="{version}" id="{APP_ID}" path="Lantern.app"/>
        </bundle-version>
    </pkg-ref>
    <product id="{APP_ID}" version="{version}"/>
    <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
    <volume-check>
        <allowed-os-versions>
            <os-version min="13.0"/>
        </allowed-os-versions>
    </volume-check>
    <choices-outline>
        <line choice="default">
            <line choice="{APP_ID}"/>
        </line>
    </choices-outline>
    <choice id="default" title="Lantern" versStr="{version}"/>
    <choice id="{APP_ID}" title="Lantern" visible="false">
        <pkg-ref id="{APP_ID}"/>
    </choice>
    <pkg-ref id="{APP_ID}" version="{version}" onConclusion="none" installKBytes="{kb}">#Lantern.pkg</pkg-ref>
</installer-gui-script>
""".encode()
        with open(bom, "rb") as fh:
            bom_bytes = fh.read()
        archive = xar([
            ("Distribution", distribution),
            ("Lantern.pkg/Bom", bom_bytes),
            ("Lantern.pkg/Payload", gzip.compress(payload, 6)),
            ("Lantern.pkg/Scripts", gzip.compress(scripts, 9)),
            ("Lantern.pkg/PackageInfo", pkginfo),
        ])
        with open(out, "wb") as fh:
            fh.write(archive)
        print(f"wrote {out}: {len(archive) / 1e6:.1f} MB, {nfiles} files, {kb // 1024} MB installed")


if __name__ == "__main__":
    main()
