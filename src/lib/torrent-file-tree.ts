import type { TorrentFile } from './qbittorrent-client';

export interface FileNode {
  type: 'file';
  name: string;
  file: TorrentFile;
}

export interface DirNode {
  type: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
  totalSize: number;
  weightedProgress: number;
  fileCount: number;
  selectedCount: number;
}

export type TreeNode = FileNode | DirNode;

export function buildFileTree(files: TorrentFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Map from dir path -> DirNode for quick lookup
  const dirMap = new Map<string, DirNode>();

  function getOrCreateDir(pathParts: string[]): DirNode {
    const fullPath = pathParts.join('/');
    const existing = dirMap.get(fullPath);
    if (existing) return existing;

    const dir: DirNode = {
      type: 'dir',
      name: pathParts[pathParts.length - 1],
      path: fullPath,
      children: [],
      totalSize: 0,
      weightedProgress: 0,
      fileCount: 0,
      selectedCount: 0,
    };
    dirMap.set(fullPath, dir);

    // Attach to parent or root
    if (pathParts.length > 1) {
      const parent = getOrCreateDir(pathParts.slice(0, -1));
      parent.children.push(dir);
    } else {
      root.push(dir);
    }

    return dir;
  }

  for (const file of files) {
    const parts = file.name.split('/');
    const fileName = parts[parts.length - 1];

    const fileNode: FileNode = { type: 'file', name: fileName, file };

    if (parts.length > 1) {
      const parentDir = getOrCreateDir(parts.slice(0, -1));
      parentDir.children.push(fileNode);
    } else {
      root.push(fileNode);
    }
  }

  // Bottom-up aggregation
  function aggregate(node: TreeNode): void {
    if (node.type === 'file') return;

    node.totalSize = 0;
    node.weightedProgress = 0;
    node.fileCount = 0;
    node.selectedCount = 0;

    for (const child of node.children) {
      aggregate(child);
      if (child.type === 'file') {
        node.totalSize += child.file.size;
        node.weightedProgress += child.file.progress * child.file.size;
        node.fileCount += 1;
        if (child.file.priority > 0) node.selectedCount += 1;
      } else {
        node.totalSize += child.totalSize;
        node.weightedProgress += child.weightedProgress;
        node.fileCount += child.fileCount;
        node.selectedCount += child.selectedCount;
      }
    }

    // Sort: dirs first, then files, alphabetically within each group
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  for (const node of root) {
    aggregate(node);
  }

  // Sort root level too
  root.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return root;
}

export function getAllFileIndices(node: TreeNode): number[] {
  if (node.type === 'file') return [node.file.index];
  const indices: number[] = [];
  for (const child of node.children) {
    indices.push(...getAllFileIndices(child));
  }
  return indices;
}

export function getCheckState(node: DirNode): 'all' | 'none' | 'indeterminate' {
  if (node.selectedCount === 0) return 'none';
  if (node.selectedCount === node.fileCount) return 'all';
  return 'indeterminate';
}
