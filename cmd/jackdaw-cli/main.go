package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"text/tabwriter"
)

type request struct {
	Method string      `json:"method"`
	Params interface{} `json:"params"`
}

type response struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

var (
	socketPath string
	jsonOutput bool
)

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		usage()
		os.Exit(1)
	}

	// Parse global flags
	var positional []string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--socket":
			if i+1 >= len(args) {
				fatal("--socket requires a value")
			}
			i++
			socketPath = args[i]
		case "--json":
			jsonOutput = true
		case "--help", "-h":
			usage()
			os.Exit(0)
		default:
			positional = append(positional, args[i])
		}
	}

	if socketPath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			fatal("cannot determine home directory: %v", err)
		}
		socketPath = filepath.Join(home, ".jackdaw", "api.sock")
	}

	if len(positional) < 2 || positional[0] != "session" {
		usage()
		os.Exit(1)
	}

	subcmd := positional[1]
	subargs := positional[2:]

	switch subcmd {
	case "list":
		cmdList()
	case "get":
		requireArgs(subargs, 1, "session get <id>")
		cmdGet(subargs[0])
	case "create":
		cmdCreate(subargs)
	case "kill":
		requireArgs(subargs, 1, "session kill <id>")
		cmdKill(subargs[0])
	case "remove":
		requireArgs(subargs, 1, "session remove <id>")
		cmdRemove(subargs[0])
	case "rename":
		requireArgs(subargs, 2, "session rename <id> <name>")
		cmdRename(subargs[0], subargs[1])
	case "write":
		requireArgs(subargs, 2, "session write <id> <input>")
		cmdWrite(subargs[0], subargs[1])
	case "read":
		requireArgs(subargs, 1, "session read <id>")
		cmdRead(subargs[0])
	case "resize":
		requireArgs(subargs, 3, "session resize <id> <cols> <rows>")
		cmdResize(subargs[0], subargs[1], subargs[2])
	case "history":
		requireArgs(subargs, 1, "session history <id>")
		cmdHistory(subargs[0])
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand: %s\n", subcmd)
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `Usage: jackdaw-cli [--socket <path>] [--json] session <command> [args...]

Commands:
  session list                          List all sessions
  session get <id>                      Get session details
  session create --dir <path> [flags]   Create a new session
  session kill <id>                     Kill a session
  session remove <id>                   Remove a session
  session rename <id> <name>            Rename a session
  session write <id> <input>            Write text to a session
  session read <id>                     Stream session output
  session resize <id> <cols> <rows>     Resize a session
  session history <id>                  Get session history

Global flags:
  --socket <path>  API socket path (default: ~/.jackdaw/api.sock)
  --json           Output raw JSON responses`)
}

func fatal(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func requireArgs(args []string, n int, usage string) {
	if len(args) < n {
		fatal("usage: jackdaw-cli %s", usage)
	}
}

func connect() net.Conn {
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		fatal("cannot connect to %s: %v\nIs Jackdaw running?", socketPath, err)
	}
	return conn
}

func send(conn net.Conn, method string, params interface{}) response {
	req := request{Method: method, Params: params}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		fatal("write: %v", err)
	}

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)
	if !scanner.Scan() {
		fatal("no response from server")
	}

	var resp response
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		fatal("invalid response: %v", err)
	}
	return resp
}

func checkError(resp response) {
	if !resp.OK {
		if resp.Error != nil {
			fatal("error: %s", resp.Error.Message)
		}
		fatal("unknown error")
	}
}

func printJSON(resp response) {
	if jsonOutput {
		os.Stdout.Write(resp.Data)
		fmt.Println()
		os.Exit(0)
	}
}

func cmdList() {
	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.list", map[string]interface{}{})
	checkError(resp)
	printJSON(resp)

	var data struct {
		Sessions []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Status  string `json:"status"`
			WorkDir string `json:"work_dir"`
		} `json:"sessions"`
	}
	json.Unmarshal(resp.Data, &data)

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tSTATUS\tWORKDIR")
	for _, s := range data.Sessions {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", s.ID, s.Name, s.Status, s.WorkDir)
	}
	w.Flush()
}

func cmdGet(id string) {
	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.get", map[string]string{"id": id})
	checkError(resp)
	printJSON(resp)

	var data map[string]interface{}
	json.Unmarshal(resp.Data, &data)
	for k, v := range data {
		fmt.Printf("%s: %v\n", k, v)
	}
}

func cmdCreate(args []string) {
	var dir, command, name string
	var cmdArgs []string

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dir":
			if i+1 >= len(args) {
				fatal("--dir requires a value")
			}
			i++
			dir = args[i]
		case "--command":
			if i+1 >= len(args) {
				fatal("--command requires a value")
			}
			i++
			command = args[i]
		case "--args":
			if i+1 >= len(args) {
				fatal("--args requires a value")
			}
			i++
			cmdArgs = strings.Split(args[i], ",")
		case "--name":
			if i+1 >= len(args) {
				fatal("--name requires a value")
			}
			i++
			name = args[i]
		default:
			fatal("unknown flag: %s", args[i])
		}
	}

	if dir == "" {
		fatal("--dir is required")
	}

	params := map[string]interface{}{"work_dir": dir}
	if command != "" {
		params["command"] = command
	}
	if len(cmdArgs) > 0 {
		params["args"] = cmdArgs
	}
	if name != "" {
		params["name"] = name
	}

	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.create", params)
	checkError(resp)
	printJSON(resp)

	var data struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	json.Unmarshal(resp.Data, &data)
	fmt.Printf("Created session %s (%s)\n", data.ID, data.Name)
}

func cmdKill(id string) {
	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.kill", map[string]string{"id": id})
	checkError(resp)
	printJSON(resp)
	fmt.Println("OK")
}

func cmdRemove(id string) {
	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.remove", map[string]string{"id": id})
	checkError(resp)
	printJSON(resp)
	fmt.Println("OK")
}

func cmdRename(id, name string) {
	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.rename", map[string]interface{}{"id": id, "name": name})
	checkError(resp)
	printJSON(resp)
	fmt.Println("OK")
}

func cmdWrite(id, input string) {
	conn := connect()
	defer conn.Close()
	encoded := base64.StdEncoding.EncodeToString([]byte(input))
	resp := send(conn, "session.write", map[string]string{"id": id, "input": encoded})
	checkError(resp)
	printJSON(resp)
	fmt.Println("OK")
}

func cmdRead(id string) {
	conn := connect()

	// Handle SIGINT gracefully
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	go func() {
		<-sigCh
		conn.Close()
		os.Exit(0)
	}()

	req := request{Method: "session.read", Params: map[string]string{"id": id}}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	conn.Write(data)

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	for scanner.Scan() {
		var resp response
		if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
			continue
		}
		if !resp.OK {
			if resp.Error != nil {
				fatal("error: %s", resp.Error.Message)
			}
			continue
		}

		if jsonOutput {
			os.Stdout.Write(scanner.Bytes())
			fmt.Println()
			continue
		}

		var m map[string]interface{}
		json.Unmarshal(resp.Data, &m)
		if out, ok := m["output"]; ok {
			decoded, err := base64.StdEncoding.DecodeString(out.(string))
			if err == nil {
				os.Stdout.Write(decoded)
			}
		}
		if eof, ok := m["eof"]; ok && eof == true {
			return
		}
	}
}

func cmdResize(id, colsStr, rowsStr string) {
	cols, err := strconv.Atoi(colsStr)
	if err != nil {
		fatal("invalid cols: %s", colsStr)
	}
	rows, err := strconv.Atoi(rowsStr)
	if err != nil {
		fatal("invalid rows: %s", rowsStr)
	}

	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.resize", map[string]interface{}{"id": id, "cols": cols, "rows": rows})
	checkError(resp)
	printJSON(resp)
	fmt.Println("OK")
}

func cmdHistory(id string) {
	conn := connect()
	defer conn.Close()
	resp := send(conn, "session.history", map[string]string{"id": id})
	checkError(resp)

	if jsonOutput {
		os.Stdout.Write(resp.Data)
		fmt.Println()
		return
	}

	var data struct {
		Output string `json:"output"`
	}
	json.Unmarshal(resp.Data, &data)
	if data.Output != "" {
		decoded, err := base64.StdEncoding.DecodeString(data.Output)
		if err != nil {
			fatal("decode history: %v", err)
		}
		os.Stdout.Write(decoded)
	}
}
