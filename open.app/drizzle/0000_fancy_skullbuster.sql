CREATE TABLE `photos_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_uuid` text NOT NULL,
	`local_uri` text NOT NULL,
	`lat` real,
	`lng` real,
	`taken_at_ms` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`synced` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trip_uuid`) REFERENCES `trips`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_photos_trip_synced` ON `photos_queue` (`trip_uuid`,`synced`);--> statement-breakpoint
CREATE TABLE `points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_uuid` text NOT NULL,
	`seq` integer NOT NULL,
	`t_ms` integer NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`alt` real,
	`spd` real,
	`brg` real,
	`acc` real,
	`hr` integer,
	`seg` integer DEFAULT 0 NOT NULL,
	`synced` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trip_uuid`) REFERENCES `trips`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_points_trip_seq` ON `points` (`trip_uuid`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_points_trip_synced` ON `points` (`trip_uuid`,`synced`);--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`uuid` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`activity_type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ended_at_ms` integer,
	`current_segment` integer DEFAULT 0 NOT NULL,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`paused_at_ms` integer,
	`battery_start` integer,
	`battery_end` integer,
	`device_info` text,
	`server_created` integer DEFAULT 0 NOT NULL,
	`synced_status` text,
	`pending_meta` integer DEFAULT 0 NOT NULL,
	`sync_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_trips_status` ON `trips` (`status`);