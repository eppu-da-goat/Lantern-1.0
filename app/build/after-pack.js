'use strict';
// Windows: set Lantern's icon and version details on Lantern.exe without Wine, using resedit
// (pure JavaScript). macOS needs nothing here.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit;
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const exe = NtExecutable.from(fs.readFileSync(exePath));
  const res = NtExecutableResource.from(exe);

  const ico = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map((i) => i.data));

  const infos = Resource.VersionInfo.fromEntries(res.entries);
  const vi = infos[0] || Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    CompanyName: 'Lantern',
    FileDescription: 'Lantern',
    ProductName: 'Lantern',
    InternalName: 'Lantern',
    OriginalFilename: 'Lantern.exe',
    LegalCopyright: 'Lantern · GPL-3.0',
    FileVersion: version,
    ProductVersion: version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • set icon and version ${version} on ${path.basename(exePath)} (resedit)`);
};
