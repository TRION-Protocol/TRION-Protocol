// AXIOM RCP Daemon — Layer 6: Resonance Communication Protocol
//
// The RCP Daemon replaces TCP/IP address-based routing with behavioral
// resonance-based routing. Connectivity is determined by shared behavioral
// vocabulary, not network addresses or ports.
//
// Author: Hudu Yusuf (Analys), @The_analys
// License: CC0 1.0 Universal

package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func main() {
	// CLI flags
	grpcAddr   := flag.String("grpc-addr", ":7777", "gRPC server address")
	akashicURL := flag.String("akashic-url", "postgres://axiom@localhost:5432/axiom", "Akashic Index URL")
	redisURL   := flag.String("redis-url", "redis://localhost:6379", "Redis URL")
	logLevel   := flag.String("log-level", "info", "Log level (debug/info/warn/error)")
	flag.Parse()

	// Initialize logger
	var logger *zap.Logger
	var err error
	if *logLevel == "debug" {
		logger, err = zap.NewDevelopment()
	} else {
		logger, err = zap.NewProduction()
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	logger.Info("AXIOM RCP Daemon starting",
		zap.String("version", "D(AXIOM,t)"),
		zap.String("grpc", *grpcAddr),
	)

	// Initialize RCP daemon
	daemon, err := rcp.NewRCPDaemon(rcp.Config{
		AkashicURL: *akashicURL,
		RedisURL:   *redisURL,
		Logger:     logger,
	})
	if err != nil {
		logger.Fatal("Failed to initialize RCP daemon", zap.Error(err))
	}

	// Start background tasks
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go daemon.RunResonanceSync(ctx)
	go daemon.RunPeerDiscovery(ctx)
	go daemon.RunBCMonitor(ctx)

	// Start gRPC server
	lis, err := net.Listen("tcp", *grpcAddr)
	if err != nil {
		logger.Fatal("Failed to listen", zap.String("addr", *grpcAddr), zap.Error(err))
	}

	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(loggingInterceptor(logger)),
		grpc.StreamInterceptor(streamLoggingInterceptor(logger)),
	)

	// Register AXIOM Node gRPC service
	rcp.RegisterAXIOMNodeServer(grpcServer, daemon)
	reflection.Register(grpcServer)

	logger.Info("RCP daemon listening", zap.String("addr", *grpcAddr))

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		logger.Info("Received shutdown signal", zap.String("signal", sig.String()))
		cancel()
		grpcServer.GracefulStop()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		logger.Error("gRPC server stopped", zap.Error(err))
	}

	logger.Info("RCP daemon shutdown complete")
}

func loggingInterceptor(logger *zap.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		logger.Debug("gRPC call",
			zap.String("method", info.FullMethod),
			zap.Duration("duration", time.Since(start)),
			zap.Error(err),
		)
		return resp, err
	}
}

func streamLoggingInterceptor(logger *zap.Logger) grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		logger.Debug("gRPC stream", zap.String("method", info.FullMethod))
		return handler(srv, ss)
	}
}
