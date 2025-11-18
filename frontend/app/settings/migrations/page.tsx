'use client';

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationsApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CheckCircle, XCircle, Loader2, Database, Play } from 'lucide-react';

export default function MigrationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['migrationsStatus'],
    queryFn: migrationsApi.getStatus,
  });

  const runMigrationsMutation = useMutation({
    mutationFn: migrationsApi.runMigrations,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migrationsStatus'] });
      toast({
        title: 'Migrations Run',
        description: 'Database migrations executed successfully.',
        variant: 'default',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Migration Error',
        description: err.message || 'Failed to run migrations.',
        variant: 'destructive',
      });
    },
  });

  const status = data?.data?.status;
  const pendingMigrations = status?.pending || [];
  const appliedMigrations = status?.applied || [];

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Database className="w-7 h-7" />
          Database Migrations
        </h1>
        <Button
          onClick={() => runMigrationsMutation.mutate()}
          disabled={runMigrationsMutation.isPending || isLoading}
        >
          {runMigrationsMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          Run Migrations
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Migration Status</CardTitle>
          <CardDescription>Overview of applied and pending database migrations.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="text-red-500">Error: {error.message}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Pending Migrations ({pendingMigrations.length})</h3>
                {pendingMigrations.length === 0 ? (
                  <p className="text-muted-foreground">No pending migrations.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingMigrations.map((migration: string) => (
                        <TableRow key={migration}>
                          <TableCell>{migration}</TableCell>
                          <TableCell>
                            <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" /> Pending
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2">Applied Migrations ({appliedMigrations.length})</h3>
                {appliedMigrations.length === 0 ? (
                  <p className="text-muted-foreground">No migrations applied yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Applied At</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {appliedMigrations.map((migration: any) => (
                        <TableRow key={migration.name}>
                          <TableCell>{migration.name}</TableCell>
                          <TableCell>{new Date(migration.applied_at).toLocaleString()}</TableCell>
                          <TableCell>
                            <CheckCircle className="w-4 h-4 text-green-500" /> Applied
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
