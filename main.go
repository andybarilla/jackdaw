package main

import (
	"embed"
	"os"

	"github.com/andybarilla/jackdaw/internal/relay"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if len(os.Args) > 1 && os.Args[1] == "relay" {
		relay.RunMain(os.Args[2:])
		return
	}

	app := NewApp()

	if err := wails.Run(&options.App{
		Title:     "Jackdaw",
		Width:     1200,
		Height:    800,
		MinWidth:  800,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.Startup,
		OnShutdown: app.Shutdown,
		Bind: []interface{}{
			app,
		},
	}); err != nil {
		panic(err)
	}
}
