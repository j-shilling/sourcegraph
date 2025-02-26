// Code generated by go-mockgen 1.3.7; DO NOT EDIT.
//
// This file was generated by running `sg generate` (or `go-mockgen`) at the root of
// this repository. To add additional mocks to this or another package, add a new entry
// to the mockgen.yaml file in the root of this repository.

package embed

import (
	"context"
	"sync"

	context1 "github.com/sourcegraph/sourcegraph/enterprise/internal/codeintel/context"
)

// MockContextService is a mock implementation of the ContextService
// interface (from the package
// github.com/sourcegraph/sourcegraph/enterprise/internal/embeddings/embed)
// used for unit testing.
type MockContextService struct {
	// SplitIntoEmbeddableChunksFunc is an instance of a mock function
	// object controlling the behavior of the method
	// SplitIntoEmbeddableChunks.
	SplitIntoEmbeddableChunksFunc *ContextServiceSplitIntoEmbeddableChunksFunc
}

// NewMockContextService creates a new mock of the ContextService interface.
// All methods return zero values for all results, unless overwritten.
func NewMockContextService() *MockContextService {
	return &MockContextService{
		SplitIntoEmbeddableChunksFunc: &ContextServiceSplitIntoEmbeddableChunksFunc{
			defaultHook: func(context.Context, string, string, context1.SplitOptions) (r0 []context1.EmbeddableChunk, r1 error) {
				return
			},
		},
	}
}

// NewStrictMockContextService creates a new mock of the ContextService
// interface. All methods panic on invocation, unless overwritten.
func NewStrictMockContextService() *MockContextService {
	return &MockContextService{
		SplitIntoEmbeddableChunksFunc: &ContextServiceSplitIntoEmbeddableChunksFunc{
			defaultHook: func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error) {
				panic("unexpected invocation of MockContextService.SplitIntoEmbeddableChunks")
			},
		},
	}
}

// NewMockContextServiceFrom creates a new mock of the MockContextService
// interface. All methods delegate to the given implementation, unless
// overwritten.
func NewMockContextServiceFrom(i ContextService) *MockContextService {
	return &MockContextService{
		SplitIntoEmbeddableChunksFunc: &ContextServiceSplitIntoEmbeddableChunksFunc{
			defaultHook: i.SplitIntoEmbeddableChunks,
		},
	}
}

// ContextServiceSplitIntoEmbeddableChunksFunc describes the behavior when
// the SplitIntoEmbeddableChunks method of the parent MockContextService
// instance is invoked.
type ContextServiceSplitIntoEmbeddableChunksFunc struct {
	defaultHook func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error)
	hooks       []func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error)
	history     []ContextServiceSplitIntoEmbeddableChunksFuncCall
	mutex       sync.Mutex
}

// SplitIntoEmbeddableChunks delegates to the next hook function in the
// queue and stores the parameter and result values of this invocation.
func (m *MockContextService) SplitIntoEmbeddableChunks(v0 context.Context, v1 string, v2 string, v3 context1.SplitOptions) ([]context1.EmbeddableChunk, error) {
	r0, r1 := m.SplitIntoEmbeddableChunksFunc.nextHook()(v0, v1, v2, v3)
	m.SplitIntoEmbeddableChunksFunc.appendCall(ContextServiceSplitIntoEmbeddableChunksFuncCall{v0, v1, v2, v3, r0, r1})
	return r0, r1
}

// SetDefaultHook sets function that is called when the
// SplitIntoEmbeddableChunks method of the parent MockContextService
// instance is invoked and the hook queue is empty.
func (f *ContextServiceSplitIntoEmbeddableChunksFunc) SetDefaultHook(hook func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error)) {
	f.defaultHook = hook
}

// PushHook adds a function to the end of hook queue. Each invocation of the
// SplitIntoEmbeddableChunks method of the parent MockContextService
// instance invokes the hook at the front of the queue and discards it.
// After the queue is empty, the default hook function is invoked for any
// future action.
func (f *ContextServiceSplitIntoEmbeddableChunksFunc) PushHook(hook func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error)) {
	f.mutex.Lock()
	f.hooks = append(f.hooks, hook)
	f.mutex.Unlock()
}

// SetDefaultReturn calls SetDefaultHook with a function that returns the
// given values.
func (f *ContextServiceSplitIntoEmbeddableChunksFunc) SetDefaultReturn(r0 []context1.EmbeddableChunk, r1 error) {
	f.SetDefaultHook(func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error) {
		return r0, r1
	})
}

// PushReturn calls PushHook with a function that returns the given values.
func (f *ContextServiceSplitIntoEmbeddableChunksFunc) PushReturn(r0 []context1.EmbeddableChunk, r1 error) {
	f.PushHook(func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error) {
		return r0, r1
	})
}

func (f *ContextServiceSplitIntoEmbeddableChunksFunc) nextHook() func(context.Context, string, string, context1.SplitOptions) ([]context1.EmbeddableChunk, error) {
	f.mutex.Lock()
	defer f.mutex.Unlock()

	if len(f.hooks) == 0 {
		return f.defaultHook
	}

	hook := f.hooks[0]
	f.hooks = f.hooks[1:]
	return hook
}

func (f *ContextServiceSplitIntoEmbeddableChunksFunc) appendCall(r0 ContextServiceSplitIntoEmbeddableChunksFuncCall) {
	f.mutex.Lock()
	f.history = append(f.history, r0)
	f.mutex.Unlock()
}

// History returns a sequence of
// ContextServiceSplitIntoEmbeddableChunksFuncCall objects describing the
// invocations of this function.
func (f *ContextServiceSplitIntoEmbeddableChunksFunc) History() []ContextServiceSplitIntoEmbeddableChunksFuncCall {
	f.mutex.Lock()
	history := make([]ContextServiceSplitIntoEmbeddableChunksFuncCall, len(f.history))
	copy(history, f.history)
	f.mutex.Unlock()

	return history
}

// ContextServiceSplitIntoEmbeddableChunksFuncCall is an object that
// describes an invocation of method SplitIntoEmbeddableChunks on an
// instance of MockContextService.
type ContextServiceSplitIntoEmbeddableChunksFuncCall struct {
	// Arg0 is the value of the 1st argument passed to this method
	// invocation.
	Arg0 context.Context
	// Arg1 is the value of the 2nd argument passed to this method
	// invocation.
	Arg1 string
	// Arg2 is the value of the 3rd argument passed to this method
	// invocation.
	Arg2 string
	// Arg3 is the value of the 4th argument passed to this method
	// invocation.
	Arg3 context1.SplitOptions
	// Result0 is the value of the 1st result returned from this method
	// invocation.
	Result0 []context1.EmbeddableChunk
	// Result1 is the value of the 2nd result returned from this method
	// invocation.
	Result1 error
}

// Args returns an interface slice containing the arguments of this
// invocation.
func (c ContextServiceSplitIntoEmbeddableChunksFuncCall) Args() []interface{} {
	return []interface{}{c.Arg0, c.Arg1, c.Arg2, c.Arg3}
}

// Results returns an interface slice containing the results of this
// invocation.
func (c ContextServiceSplitIntoEmbeddableChunksFuncCall) Results() []interface{} {
	return []interface{}{c.Result0, c.Result1}
}
