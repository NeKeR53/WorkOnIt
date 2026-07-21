use workonit_lib::{
    automation::{
        ActionChain, CancellationToken, ChainStatus, CommandAction, CommandVariant,
        ExecutionCoordinator, OperatingSystem, OutputValidation, StepStatus,
    },
    domain::{Board, CustomFieldValue, WipPolicy},
};

#[test]
fn action_chain_receives_task_data_and_stops_on_failure() {
    let mut board = Board::new("Livraison");
    let column = board.add_column("Prêt", WipPolicy::None);
    let task_id = board
        .add_task("Version 1.0", &column)
        .expect("task created");
    board.tasks[0].custom_values.insert(
        "release channel".into(),
        CustomFieldValue::Text("stable".into()),
    );
    let task = board.tasks.iter().find(|task| task.id == task_id).unwrap();
    let read_task = if cfg!(target_os = "windows") {
        "Write-Output -NoNewline \"$env:WORKONIT_TITLE`:$env:WORKONIT_FIELD_RELEASE_CHANNEL\""
    } else {
        "printf '%s:%s' \"$WORKONIT_TITLE\" \"$WORKONIT_FIELD_RELEASE_CHANNEL\""
    };
    let fail = if cfg!(target_os = "windows") {
        "[Console]::Error.Write('incident'); exit 7"
    } else {
        "printf 'incident' >&2; exit 7"
    };
    let unexpected = if cfg!(target_os = "windows") {
        "Write-Output -NoNewline 'unexpected'"
    } else {
        "printf 'unexpected'"
    };
    let actions = vec![
        CommandAction::shell("Lire le titre", read_task),
        CommandAction::shell("Échouer", fail),
        CommandAction::shell("Ne doit pas tourner", unexpected),
    ];

    let execution = ActionChain::new(actions).run(task, 0);

    assert_eq!(execution.status, ChainStatus::Failed);
    assert_eq!(execution.failed_step, Some(1));
    assert_eq!(execution.steps.len(), 2);
    assert_eq!(execution.steps[0].stdout, "Version 1.0:stable");
    assert_eq!(execution.steps[1].exit_code, Some(7));
    assert_eq!(execution.steps[1].stderr, "incident");
}

#[test]
fn execution_coordinator_rejects_duplicate_tasks_and_exposes_cancellation() {
    let coordinator = ExecutionCoordinator::default();
    let guard = coordinator.start("task-1").unwrap();
    assert!(coordinator.start("task-1").is_err());
    assert!(coordinator.cancel("task-1"));
    drop(guard);
    assert!(!coordinator.cancel("task-1"));
    assert!(coordinator.start("task-1").is_ok());

    let guard = coordinator.start("task-2").unwrap();
    let mut board = Board::starter("Guard");
    board
        .add_task("Task", &board.columns[0].id.clone())
        .unwrap();
    let action = CommandAction::shell(
        "Guarded",
        if cfg!(target_os = "windows") {
            "Write-Output -NoNewline ok"
        } else {
            "printf ok"
        },
    );
    let step = workonit_lib::automation::ActionExecutor::execute(
        &guard.executor(),
        &action,
        &board.tasks[0],
    );
    assert_eq!(step.stdout, "ok");
}

#[test]
fn cancellation_stops_a_running_action_chain() {
    let mut board = Board::new("Livraison");
    let column = board.add_column("Prêt", WipPolicy::None);
    board.add_task("Version", &column).unwrap();
    let task = board.tasks[0].clone();
    let script = if cfg!(target_os = "windows") {
        "Start-Sleep -Seconds 10"
    } else {
        "trap '' TERM; sleep 10"
    };
    let action = CommandAction::shell("Longue", script);
    let cancellation = CancellationToken::default();
    let worker_token = cancellation.clone();
    let started = std::time::Instant::now();
    let worker = std::thread::spawn(move || {
        ActionChain::new(vec![action]).run_with_cancellation(&task, 0, &worker_token)
    });

    std::thread::sleep(std::time::Duration::from_millis(80));
    cancellation.cancel();
    let execution = worker.join().unwrap();

    assert_eq!(execution.status, ChainStatus::Cancelled);
    assert_eq!(execution.steps[0].status, StepStatus::Cancelled);
    assert!(started.elapsed() < std::time::Duration::from_secs(3));
}

#[test]
fn action_selects_platform_variant_and_validates_stdout() {
    let mut action = CommandAction::shell("Vérifier", "printf legacy");
    action.variants = vec![CommandVariant {
        operating_system: OperatingSystem::current(),
        runner: if cfg!(target_os = "windows") {
            "cmd"
        } else if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        }
        .into(),
        script: if cfg!(target_os = "windows") {
            "echo {\"ready\":true}"
        } else {
            "printf '{\"ready\":true}'"
        }
        .into(),
    }];
    action.stdout_validation = Some(OutputValidation::JsonPath("$.ready".into()));
    let mut board = Board::new("Livraison");
    let column = board.add_column("Prêt", WipPolicy::None);
    let task_id = board.add_task("Version", &column).unwrap();

    let execution = ActionChain::new(vec![action]).run(&board.tasks[0], 0);

    assert_eq!(execution.status, ChainStatus::Succeeded);
    assert_eq!(execution.steps[0].status, StepStatus::Succeeded);
    assert_eq!(task_id, board.tasks[0].id);
}

#[test]
fn action_reports_incompatible_platform_and_failed_validation() {
    let current = OperatingSystem::current();
    let other = if current == OperatingSystem::Windows {
        OperatingSystem::MacOs
    } else {
        OperatingSystem::Windows
    };
    let mut incompatible = CommandAction::shell("Autre OS", "ignored");
    incompatible.variants = vec![CommandVariant {
        operating_system: other,
        runner: "ignored".into(),
        script: "ignored".into(),
    }];
    let mut invalid = CommandAction::shell("Validation", "printf 'nope'");
    invalid.stdout_validation = Some(OutputValidation::Regex("^yes$".into()));
    let mut board = Board::new("Livraison");
    let column = board.add_column("Prêt", WipPolicy::None);
    board.add_task("Version", &column).unwrap();

    let first = ActionChain::new(vec![incompatible]).run(&board.tasks[0], 0);
    let second = ActionChain::new(vec![invalid]).run(&board.tasks[0], 0);

    assert_eq!(first.steps[0].status, StepStatus::Incompatible);
    assert_eq!(second.steps[0].status, StepStatus::Failed);
}

#[test]
fn action_handles_spawn_errors_profile_timeout_exit_codes_and_output_limits() {
    let mut board = Board::starter("Commands");
    board
        .add_task("Task", &board.columns[0].id.clone())
        .unwrap();
    let task = &board.tasks[0];

    let mut missing = CommandAction::shell("Missing", "ignored");
    missing.runner = "/definitely/missing/workonit-runner".into();
    assert_eq!(
        ActionChain::new(vec![missing]).run(task, 0).steps[0].status,
        StepStatus::Failed
    );

    let mut profile = CommandAction::shell(
        "Profile",
        if cfg!(target_os = "windows") {
            "Write-Output -NoNewline ok"
        } else {
            "printf ok"
        },
    );
    profile.load_profile = true;
    profile.accepted_exit_codes = vec![3];
    profile.script = if cfg!(target_os = "windows") {
        "Write-Output -NoNewline ok; exit 3"
    } else {
        "printf ok; exit 3"
    }
    .into();
    let result = ActionChain::new(vec![profile]).run(task, 0);
    assert_eq!(result.status, ChainStatus::Succeeded);

    let mut truncated = CommandAction::shell(
        "Truncated",
        if cfg!(target_os = "windows") {
            "[Console]::Out.Write('abcdef'); [Console]::Error.Write('uvwxyz')"
        } else {
            "printf abcdef; printf uvwxyz >&2"
        },
    );
    truncated.output_limit_bytes = 3;
    let step = ActionChain::new(vec![truncated])
        .run(task, 0)
        .steps
        .remove(0);
    assert_eq!(step.stdout_bytes, b"abc");
    assert_eq!(step.stderr_bytes, b"uvw");
    assert!(step.stdout_truncated && step.stderr_truncated);

    let mut timeout = CommandAction::shell(
        "Timeout",
        if cfg!(target_os = "windows") {
            "Start-Sleep -Seconds 3"
        } else {
            "sleep 3"
        },
    );
    timeout.timeout_seconds = Some(0);
    assert_eq!(
        ActionChain::new(vec![timeout]).run(task, 0).status,
        ChainStatus::TimedOut
    );
}

#[test]
fn chains_skip_disabled_continue_after_failure_and_validate_regex_and_json_errors() {
    let mut board = Board::starter("Chains");
    board
        .add_task("Task", &board.columns[0].id.clone())
        .unwrap();
    let task = &board.tasks[0];
    let mut disabled = CommandAction::shell("Disabled", "ignored");
    disabled.enabled = false;
    let mut failure = CommandAction::shell("Failure", "exit 2");
    failure.stop_on_failure = false;
    let success = CommandAction::shell(
        "Success",
        if cfg!(target_os = "windows") {
            "Write-Output -NoNewline done"
        } else {
            "printf done"
        },
    );
    let chain = ActionChain::new(vec![disabled, failure, success]).run(task, 0);
    assert_eq!(chain.steps.len(), 2);
    assert_eq!(chain.failed_step, Some(1));
    assert_eq!(chain.steps[1].stdout, "done");

    for validation in [
        OutputValidation::Regex("[".into()),
        OutputValidation::JsonPath("$.ready".into()),
    ] {
        let mut action = CommandAction::shell(
            "Invalid",
            if cfg!(target_os = "windows") {
                "Write-Output -NoNewline nope"
            } else {
                "printf nope"
            },
        );
        action.stdout_validation = Some(validation);
        assert_eq!(
            ActionChain::new(vec![action]).run(task, 0).status,
            ChainStatus::Failed
        );
    }
    let empty = ActionChain::new(Vec::new()).run(task, 4);
    assert_eq!(empty.status, ChainStatus::Succeeded);
    assert!(empty.steps.is_empty());
}

#[test]
fn custom_executable_uses_explicit_arguments_without_shell_translation() {
    let mut action = CommandAction::shell("Direct", "ignored");
    action.direct_execution = true;
    if cfg!(target_os = "windows") {
        action.runner = "cmd".into();
        action.arguments = vec!["/C".into(), "echo direct".into()];
    } else {
        action.runner = "/usr/bin/printf".into();
        action.arguments = vec!["%s".into(), "direct".into()];
    }
    let mut board = Board::new("Livraison");
    let column = board.add_column("Prêt", WipPolicy::None);
    board.add_task("Version", &column).unwrap();

    let execution = ActionChain::new(vec![action]).run(&board.tasks[0], 0);

    assert_eq!(execution.steps[0].status, StepStatus::Succeeded);
    assert!(execution.steps[0].stdout.contains("direct"));
}
