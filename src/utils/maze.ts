import { writeFile } from "node:fs/promises";

export type MazeCell = string;
export type Maze = MazeCell[][];

/**
 * Convert a 2D maze grid into a printable string.
 */
export function renderMaze(maze: Maze): string {
  return maze.map((row) => row.join("")).join("\n");
}

/**
 * Print a maze to stdout and write the same output to a local file.
 */
export async function printMazeToFile(
  maze: Maze,
  outputPath: string,
): Promise<string> {
  const renderedMaze = renderMaze(maze);

  console.log(renderedMaze);
  await writeFile(outputPath, `${renderedMaze}\n`, "utf8");

  return renderedMaze;
}

// Example:
// await printMazeToFile(
//   [
//     ["#", "#", "#", "#", "#"],
//     ["#", "S", " ", "E", "#"],
//     ["#", "#", "#", "#", "#"],
//   ],
//   "./maze.txt",
// );
