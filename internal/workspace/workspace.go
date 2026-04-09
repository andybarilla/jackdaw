package workspace

import (
	"fmt"
	"time"
)

type Workspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func GenerateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

func DefaultWorkspace() Workspace {
	return Workspace{ID: "default", Name: "Default"}
}
