const path = require('node:path')
const rcedit = require('rcedit')

/**
 * electron-builder normally edits Windows resources through winCodeSign, whose
 * archive requires symlink privileges to unpack on some Windows machines.  We
 * keep signing disabled for the unsigned open-source build and apply the same
 * branding with the standalone rcedit package instead.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const productName = context.packager.appInfo.productName
  const executable = path.join(context.appOutDir, `${productName}.exe`)
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico')
  const version = context.packager.appInfo.version

  await rcedit(executable, {
    icon,
    'file-version': version,
    'product-version': version,
    'version-string': {
      CompanyName: 'Clarity Desk contributors',
      FileDescription: productName,
      InternalName: 'clarity-desk',
      LegalCopyright: 'Copyright (c) Clarity Desk contributors',
      OriginalFilename: `${productName}.exe`,
      ProductName: productName,
    },
  })
}
