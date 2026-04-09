package api

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
)

// handlerFunc processes a request and returns response data, or nil for streaming handlers.
type handlerFunc func(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error)

// handlers maps method names to their handler functions.
// Populated by init() in this file; extended by other files in the package.
var handlers = map[string]handlerFunc{}

// apiError carries a code alongside the message for structured error responses.
type apiError struct {
	code    string
	message string
}

func (e *apiError) Error() string { return e.message }

func errNotFound(msg string) error      { return &apiError{code: "not_found", message: msg} }
func errInvalidParams(msg string) error { return &apiError{code: "invalid_params", message: msg} }
func errInternal(msg string) error      { return &apiError{code: "internal", message: msg} }

func mapError(err error) *ErrorDetail {
	if ae, ok := err.(*apiError); ok {
		return &ErrorDetail{Code: ae.code, Message: ae.message}
	}
	msg := err.Error()
	if strings.Contains(msg, "not found") {
		return &ErrorDetail{Code: "not_found", Message: msg}
	}
	return &ErrorDetail{Code: "internal", Message: msg}
}

func requireString(params json.RawMessage, field string) (string, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(params, &m); err != nil {
		return "", errInvalidParams("invalid params: " + err.Error())
	}
	raw, ok := m[field]
	if !ok || len(raw) == 0 {
		return "", errInvalidParams(fmt.Sprintf("missing required param %q", field))
	}
	var val string
	if err := json.Unmarshal(raw, &val); err != nil {
		return "", errInvalidParams(fmt.Sprintf("param %q must be a string", field))
	}
	return val, nil
}
