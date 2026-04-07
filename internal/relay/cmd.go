package relay

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func RunMain(args []string) {
	fs := flag.NewFlagSet("relay", flag.ExitOnError)
	sockPath := fs.String("socket", "", "Unix socket path")
	workDir := fs.String("workdir", "", "Working directory")
	command := fs.String("command", "", "Command to run")
	cmdArgs := fs.String("args", "", "JSON-encoded command arguments")
	bufSize := fs.Int("buffer", 1024*1024, "Scrollback buffer size in bytes")
	historyPath := fs.String("history", "", "History file path")
	historyMax := fs.Int64("history-max", 1048576, "Maximum history file size in bytes")

	fs.Parse(args)

	if *sockPath == "" || *command == "" {
		fmt.Fprintf(os.Stderr, "usage: jackdaw relay -socket PATH -command CMD [-workdir DIR] [-args a,b,c]\n")
		os.Exit(1)
	}

	if *workDir == "" {
		*workDir, _ = os.Getwd()
	}

	var parsedArgs []string
	if *cmdArgs != "" {
		if err := json.Unmarshal([]byte(*cmdArgs), &parsedArgs); err != nil {
			fmt.Fprintf(os.Stderr, "relay: invalid -args JSON: %v\n", err)
			os.Exit(1)
		}
	}

	srv, err := NewServer(*sockPath, *workDir, *command, parsedArgs, *bufSize, *historyPath, *historyMax)
	if err != nil {
		fmt.Fprintf(os.Stderr, "relay: %v\n", err)
		os.Exit(1)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		srv.Close()
		os.Exit(0)
	}()

	srv.Serve()
}
