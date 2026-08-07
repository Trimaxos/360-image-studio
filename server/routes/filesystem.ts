import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';

export const filesystemRouter = Router();

filesystemRouter.get('/browse', async (req, res) => {
  try {
    const targetPath = String(req.query.path || process.env.HOME || '/');
    const resolved = path.resolve(targetPath);

    // Security: prevent traversal outside allowed roots
    const allowedRoots = [process.env.HOME || '/home', '/tmp', '/mnt', '/media', '/Volumes'];
    const isAllowed = allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
    if (!isAllowed) {
      return res.status(403).json({ error: 'Từ chối truy cập: đường dẫn nằm ngoài thư mục cho phép' });
    }

    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Đường dẫn không phải thư mục' });
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        path: path.join(resolved, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(resolved);

    res.json({
      path: resolved,
      parent: parent !== resolved ? parent : null,
      directories,
    });
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return res.status(404).json({ error: `Không tìm thấy thư mục: ${err.path || ''}` });
    }
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: 'Không có quyền truy cập' });
    }
    res.status(500).json({ error: err.message });
  }
});
