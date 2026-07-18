import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';


interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-slate-950 text-red-500 p-8 font-mono flex flex-col items-center justify-center">
          <div className="max-w-2xl bg-black border border-red-800 rounded-lg p-6 shadow-2xl">
            <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <span className="text-red-500">⚠️</span> Fatal Simulation Error
            </h1>
            <p className="text-slate-300 mb-4">
              The Telescope Trainer encountered a critical runtime exception and crashed.
            </p>
            
            <div className="bg-red-950 p-4 rounded overflow-x-auto mb-4 text-xs">
              <p className="font-bold mb-2">{this.state.error && this.state.error.toString()}</p>
              <pre className="text-red-400">
                {this.state.errorInfo && this.state.errorInfo.componentStack}
              </pre>
            </div>
            
            <button 
              className="bg-red-900 hover:bg-red-800 text-white px-4 py-2 rounded transition-colors"
              onClick={() => window.location.reload()}
            >
              Restart Simulator
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
