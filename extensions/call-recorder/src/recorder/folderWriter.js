/** Copies a finished recording into the folder the user chose, as a stream, so it never sits in memory. */
export class DirectoryFolderWriter {
  handles;
  constructor(handles) {
    this.handles = handles;
  }
  async write(file, fileName) {
    const dir = await this.handles.get();
    if (!dir) throw new Error("No output folder is chosen.");
    // Asking needs a click, and the popup does it when Start is pressed. Here we can only check.
    if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
      throw new Error("Chrome needs you to allow the output folder again.");
    }
    const target = await dir.getFileHandle(await this.freeName(dir, fileName), { create: true });
    await file.stream().pipeTo(await target.createWritable());
    return { folderName: dir.name };
  }
  /** call.mp4, then call-2.mp4, call-3.mp4: never overwrite someone's file. */
  async freeName(dir, fileName) {
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? fileName : `${stem}-${n}${ext}`;
      try {
        await dir.getFileHandle(candidate);
      } catch (e) {
        if (e.name === "NotFoundError") return candidate;
        throw e;
      }
    }
  }
}
