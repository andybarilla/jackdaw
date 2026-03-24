<script lang="ts">
  import {
    Terminal,
    FileText,
    Pencil,
    FilePlus,
    FolderSearch,
    Search,
    Bot,
    Wrench,
  } from 'lucide-svelte';

  interface Props {
    tool_name: string;
    size?: number;
  }

  let { tool_name, size = 12 }: Props = $props();

  const toolConfig: Record<string, { icon: typeof Terminal; colorClass: string }> = {
    Bash: { icon: Terminal, colorClass: 'tool-green' },
    Read: { icon: FileText, colorClass: 'tool-blue' },
    Edit: { icon: Pencil, colorClass: 'tool-orange' },
    Write: { icon: FilePlus, colorClass: 'tool-orange' },
    Glob: { icon: FolderSearch, colorClass: 'tool-purple' },
    Grep: { icon: Search, colorClass: 'tool-purple' },
    Agent: { icon: Bot, colorClass: 'tool-cyan' },
  };

  let config = $derived(toolConfig[tool_name] ?? { icon: Wrench, colorClass: 'tool-gray' });
</script>

<span class="tool-icon {config.colorClass}">
  {#if config}
    {@const Icon = config.icon}
    <Icon {size} strokeWidth={2} />
  {/if}
</span>

<style>
  .tool-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .tool-green { color: var(--green); }
  .tool-blue { color: var(--blue); }
  .tool-orange { color: var(--orange); }
  .tool-purple { color: var(--purple); }
  .tool-cyan { color: var(--cyan); }
  .tool-gray { color: var(--text-muted); }
</style>
