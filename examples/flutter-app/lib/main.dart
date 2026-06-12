import 'package:flutter/material.dart';

void main() {
  runApp(const MotionExampleApp());
}

class MotionExampleApp extends StatelessWidget {
  const MotionExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: ElevatedButton(
            onPressed: () {},
            child: const Text('Send payment'),
          ),
        ),
      ),
    );
  }
}
