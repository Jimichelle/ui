import { existsSync, promises as fs } from "fs"
import path, { basename } from "path"
import { Config } from "@/src/utils/get-config"
import { highlighter } from "@/src/utils/highlighter"
import { logger } from "@/src/utils/logger"
import {
  getRegistryBaseColor,
  getRegistryItemFileTargetPath,
} from "@/src/utils/registry"
import { RegistryItem } from "@/src/utils/registry/schema"
import { transform } from "@/src/utils/transformers"
import { transformCssVars } from "@/src/utils/transformers/transform-css-vars"
import { transformImport } from "@/src/utils/transformers/transform-import"
import { transformRsc } from "@/src/utils/transformers/transform-rsc"
import { transformTwPrefixes } from "@/src/utils/transformers/transform-tw-prefix"
import ora from "ora"
import prompts from "prompts"

export async function updateFiles(
  files: RegistryItem["files"],
  config: Config,
  options: {
    overwrite?: boolean
    force?: boolean
  }
) {
  if (!files?.length) {
    return
  }
  options = {
    overwrite: false,
    force: false,
    ...options,
  }
  const filesCreatedSpinner = ora(`Updating files.`)?.start()
  const baseColor = await getRegistryBaseColor(config.tailwind.baseColor)
  const filesCreated = []
  const filesUpdated = []
  const filesSkipped = []

  for (const file of files) {
    if (!file.content) {
      continue
    }

    const targetDir = getRegistryItemFileTargetPath(file, config)
    const fileName = basename(file.path)
    let filePath = path.join(targetDir, fileName)

    if (!config.tsx) {
      filePath = filePath.replace(/\.tsx?$/, (match) =>
        match === ".tsx" ? ".jsx" : ".js"
      )
    }

    const existingFile = existsSync(filePath)
    if (existingFile && !options.overwrite) {
      filesCreatedSpinner.stop()
      const { overwrite } = await prompts({
        type: "confirm",
        name: "overwrite",
        message: `The file ${highlighter.info(
          fileName
        )} already exists. Would you like to overwrite?`,
        initial: false,
      })

      if (!overwrite) {
        filesSkipped.push(path.relative(config.resolvedPaths.cwd, filePath))
        continue
      }
      filesCreatedSpinner?.start()
    }

    // Create the target directory if it doesn't exist.
    if (!existsSync(targetDir)) {
      await fs.mkdir(targetDir, { recursive: true })
    }

    // Run our transformers.
    const content = await transform(
      {
        filename: file.path,
        raw: file.content,
        config,
        baseColor,
        transformJsx: !config.tsx,
      },
      [transformImport, transformRsc, transformCssVars, transformTwPrefixes]
    )

    await fs.writeFile(filePath, content, "utf-8")
    existingFile
      ? filesUpdated.push(path.relative(config.resolvedPaths.cwd, filePath))
      : filesCreated.push(path.relative(config.resolvedPaths.cwd, filePath))
  }

  const hasUpdatedFiles = filesCreated.length || filesUpdated.length
  if (!hasUpdatedFiles && !filesSkipped.length) {
    filesCreatedSpinner?.info("No files updated.")
  }

  if (filesCreated.length) {
    filesCreatedSpinner?.succeed(
      `Created ${filesCreated.length} ${
        filesCreated.length === 1 ? "file" : "files"
      }:`
    )
    for (const file of filesCreated) {
      logger.log(`  - ${file}`)
    }
  } else {
    filesCreatedSpinner?.stop()
  }

  if (filesUpdated.length) {
    ora(
      `Updated ${filesUpdated.length} ${
        filesUpdated.length === 1 ? "file" : "files"
      }:`
    )?.info()
    for (const file of filesUpdated) {
      logger.log(`  - ${file}`)
    }
  }

  if (filesSkipped.length) {
    ora(
      `Skipped ${filesSkipped.length} ${
        filesUpdated.length === 1 ? "file" : "files"
      }:`
    )?.info()
    for (const file of filesSkipped) {
      logger.log(`  - ${file}`)
    }
  }

  logger.break()
}
