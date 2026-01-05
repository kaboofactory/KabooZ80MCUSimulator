const SAMPLES = {
    "Output Test": `; ============================================================================
; OUTPUT DEVICE TEST (出力デバイス総合テスト)
; ============================================================================
;
; このプログラムは、KabooZ80 Simulator に接続された下記の出力デバイスを
; 順次制御して動作確認を行うデモプログラムです。
;
; 1. LED (Port 0x00)          : 2進数カウンタ (0-255)
; 2. 7-Segment (Port 0x10-17) : 値のシフト表示テスト
; 3. LCD 16x2 (Port 0x20,21)  : ランダム文字出力 + 左スクロール (2行表示)
; 4. Dot Matrix (Port 0x80-9F): パターンアニメーション
; 5. Buzzer (Port 0x30)       : 1秒ごとのトーン出力 (※デフォルトでコメントアウト)
;
; ============================================================================

    ORG 0x0000
    JP START

    ; --- 割り込みベクタ (現在は未使用ですが、配置場所を確保) ---
    ORG 0x0038
    RETI

; ----------------------------------------------------------------------------
; 定数定義 (CONSTANTS)
; ----------------------------------------------------------------------------
PORT_LED        EQU 0x00    ; 8連LED
PORT_7SEG_BASE  EQU 0x10    ; 7セグメントディスプレイ (8桁: 0x10-0x17)
PORT_LCD_CMD    EQU 0x20    ; LCD コマンドポート
PORT_LCD_DAT    EQU 0x21    ; LCD データポート
PORT_BUZZER     EQU 0x30    ; 圧電ブザー
PORT_KEYPAD     EQU 0x40    ; キーパッド (入力)
PORT_DIP_BASE   EQU 0x50    ; DIPスイッチ (入力)
PORT_BTN        EQU 0x60    ; 割り込みボタン
PORT_MATRIX_BASE EQU 0x80   ; ドットマトリクス (16行x2)
PORT_RTC_SEC    EQU 0xC0    ; リアルタイムクロック (秒)

; ----------------------------------------------------------------------------
; メインプログラム (MAIN PROGRAM)
; ----------------------------------------------------------------------------
    ORG 0x0100
START:
    LD SP, 0xFFFF           ; スタックポインタ初期化
    
    ; --- LCD初期化 ---
    LD A, 0x01              ; Clear Display コマンド
    OUT (PORT_LCD_CMD), A
    
    ; --- 変数初期化 ---
    XOR A
    LD (VAR_LED), A
    LD (VAR_7SEG), A
    LD (VAR_LCD_IDX), A
    LD (VAR_MAT_STEP), A
    LD (VAR_BUZZ_TONE), A
    
    ; --- 乱数シード初期化 ---
    ; メモリ末尾で定義されたDW値(RNG_SEED)を使用するため、
    ; ここでのハードコード初期化は行いません。
    ; LD HL, 0xACE1
    ; LD (RNG_SEED), HL

MAIN_LOOP:
    ; --------------------------------------------------------
    ; 1. LED 更新 (2進数カウンタ)
    ; --------------------------------------------------------
    LD A, (VAR_LED)
    INC A
    LD (VAR_LED), A
    OUT (PORT_LED), A       ; ポート0へ出力

    ; --------------------------------------------------------
    ; 2. 7セグメント 更新 (シフト表示)
    ; --------------------------------------------------------
    CALL UPDATE_7SEG

    ; --------------------------------------------------------
    ; 3. LCD 更新 (ランダム文字・スクロール)
    ; --------------------------------------------------------
    CALL UPDATE_LCD

    ; --------------------------------------------------------
    ; 4. ドットマトリクス 更新 (アニメーション)
    ; --------------------------------------------------------
    CALL UPDATE_MATRIX

    ; --------------------------------------------------------
    ; 5. ブザー 更新
    ; --------------------------------------------------------
    ; ※ 音が出るため、必要に応じてコメントアウトを解除してください
    ; CALL UPDATE_BUZZER

    ; --------------------------------------------------------
    ; ウェイト処理 (目視できるように遅延を入れる)
    ; --------------------------------------------------------
    CALL DELAY_MS
    
    JP MAIN_LOOP            ; 無限ループ

; ----------------------------------------------------------------------------
; サブルーチン (SUBROUTINES)
; ----------------------------------------------------------------------------

; --- 7セグメント更新 ---
; VAR_LED の値を少しずつずらしながら8桁に表示します
UPDATE_7SEG:
    LD HL, VAR_LED
    LD A, (HL)
    LD B, A                 ; ベース値
    
    LD C, PORT_7SEG_BASE    ; 最初の桁 (0x10)
    LD D, 8                 ; 8桁分ループ
U7_LOOP:
    LD A, B
    OUT (C), A              ; 出力
    ADD A, 32               ; 次の桁のために値をずらす (デモ用演出)
    LD B, A
    INC C                   ; 次のポートへ
    DEC D
    JR NZ, U7_LOOP
    RET

; --- LCD更新 ---
; 画面全体を左にシフトし、右端に新しいランダム文字を追加します
UPDATE_LCD:
    ; 1. 画面全体を左にシフト (Cursor or Display Shift コマンド)
    LD A, 0x18              ; 0001 10xx (S/C=1:Display, R/L=0:Left)
    OUT (PORT_LCD_CMD), A
    
    ; 2. 1行目の右端へカーソル移動
    ; DDRAM Address Set 0x80 | Address
    ; 1行目の末尾は 0x0F (16文字目) ですが、シフトされているため
    ; 仮想的な右端に書き込むことでティッカー表示になります。
    LD A, 0x8F              ; 0x80 + 0x0F
    OUT (PORT_LCD_CMD), A

    ; 3. ランダムな文字を生成して書き込み (1行目)
    CALL RAND
    AND 0x3F                ; 0-63 に制限
    ADD A, 0x20             ; +32 (ASCII 0x20 Space ～ 0x5F '_')
    OUT (PORT_LCD_DAT), A   ; データ書き込み
    
    ; 4. 2行目の右端へカーソル移動
    ; 2行目の先頭アドレスは 0x40 なので、2行目末尾は 0x4F
    LD A, 0xCF              ; 0x80 + 0x4F
    OUT (PORT_LCD_CMD), A
    
    ; 5. ランダムな文字を生成して書き込み (2行目)
    CALL RAND
    AND 0x3F
    ADD A, 0x20
    OUT (PORT_LCD_DAT), A
    
    RET

; --- マトリクス更新 ---
; VAR_MAT_STEP に応じて市松模様をアニメーションさせます
UPDATE_MATRIX:
    LD A, (VAR_MAT_STEP)
    INC A
    AND 0x0F                ; 0-15 でループ
    LD (VAR_MAT_STEP), A
    
    LD B, 0                 ; 行カウンタ
    LD C, PORT_MATRIX_BASE  ; ポート 0x80 から開始
MAT_LOOP:
    LD A, (VAR_MAT_STEP)
    ADD A, B                ; ステップ数 + 行番号
    AND 1                   ; 偶数か奇数か
    JR Z, MAT_ODD
    LD A, 0xAA              ; 10101010 (偶数パタン)
    JR MAT_SET
MAT_ODD:
    LD A, 0x55              ; 01010101 (奇数パタン)
MAT_SET:
    OUT (C), A              ; 左側8ドット出力
    INC C
    OUT (C), A              ; 右側8ドット出力 (同じパタン)
    INC C
    INC B                   ; 次の行へ
    LD A, B
    CP 16
    JR NZ, MAT_LOOP
    RET

; --- ブザー更新 ---
; RTCの秒が変わるたびにトーンを変更します
UPDATE_BUZZER:
    IN A, (PORT_RTC_SEC)    ; 現在の秒を取得
    LD HL, LAST_SEC
    CP (HL)
    RET Z                   ; 秒が変わっていなければ何もしない
    
    ; 秒が変わった
    LD (HL), A              ; 現在秒を保存
    
    ; トーン変更 (周波数パラメータ)
    LD A, (VAR_BUZZ_TONE)
    ADD A, 10
    LD (VAR_BUZZ_TONE), A
    
    ; ブザーポートに出力
    OUT (PORT_BUZZER), A
    RET

; --- ウェイト (簡易遅延) ---
DELAY_MS:
    LD BC, 0x2000           ; ループ回数 (クロック周波数に依存します)
DLY:
    DEC BC
    LD A, B
    OR C
    JR NZ, DLY
    RET

; --- 乱数生成 (Xorshift / LFSR) ---
RAND:
    LD HL, (RNG_SEED)
    INC HL                  ; パターン固定化防止のインクリメント
    LD A, H
    RLCA                    ; 左回転
    XOR L
    RLCA
    XOR H
    LD H, L
    LD L, A
    LD (RNG_SEED), HL
    RET

; ----------------------------------------------------------------------------
; 変数・ワークエリア (VARIABLES)
; ----------------------------------------------------------------------------
VAR_LED:        DB 0
VAR_7SEG:       DB 0
VAR_LCD_IDX:    DB 0  ; (未使用)
VAR_MAT_STEP:   DB 0  ; アニメーション用ステップ
VAR_BUZZ_TONE:  DB 0  ; 現在のブザートーン
LAST_SEC:       DB 0  ; RTC秒保存用
RNG_SEED:       DW 0x1234 ; 乱数シード (ここを変更すると乱数系列が変わります)
`,

    "Breakout Game": `; ============================================================================
; KabooZ80 Breakout (ブロック崩し) Sample
; ============================================================================
;
; このプログラムは、KabooZ80 MCU Simulator の周辺デバイス制御のデモです。
; 以下の機能を使用します：
; 1. Dot Matrix (16x16) : ゲーム画面の描画 (ポート 0x80-0x9F)
; 2. Keypad             : パドルの左右移動操作 (ポート 0x40)
;
; ■ ハードウェアマッピング解説
; 
; [Dot Matrix] (ポート 0x80 - 0x9F)
;  16x16 ドットマトリクスは、16行 x 16列のピクセルを持ちます。
;  各行は2つの8ビットポートで制御します。
;  - 行 N の左半分 (列 0-7) : ポート番号 0x80 + (行番号 * 2)
;  - 行 N の右半分 (列 8-15): ポート番号 0x80 + (行番号 * 2) + 1
;
; [Keypad] (ポート 0x40)
;  - 入力ポート 0x40 から押されたキーのコードを読み取ります。
;  - 何も押されていない場合は 0xFF が返ります。
;  - 今回は '4' (左移動) と '6' (右移動) を使用します。
;
; ============================================================================

; ----------------------------------------------------------------------------
; 定数定義 (CONSTANTS)
; ----------------------------------------------------------------------------
PORT_KEY    EQU 0x40        ; キーパッドのポート番号
PORT_MAT_BASE EQU 0x80      ; ドットマトリクスのベースポート番号

; キーコード (シミュレータのキーパッド配列に対応)
KEY_LEFT    EQU 4           ; '4' キー (左移動)
KEY_RIGHT   EQU 6           ; '6' キー (右移動)

; ゲーム設定
PADDLE_Y    EQU 15          ; パドルのY座標 (最下段: 15)
PADDLE_W    EQU 6           ; パドルの幅 (ピクセル数)

; ----------------------------------------------------------------------------
; 変数領域 (RAM)
; 通常 0xC000 以降をワークエリアとして使用します
; ----------------------------------------------------------------------------
    ORG 0xC000

BALL_X:     DB 0            ; ボールのX座標 (0-15)
BALL_Y:     DB 0            ; ボールのY座標 (0-15)
BALL_DX:    DB 0            ; ボールのX速度 (1:右へ, -1(255):左へ)
BALL_DY:    DB 0            ; ボールのY速度 (1:下へ, -1(255):上へ)
PADDLE_X:   DB 0            ; パドルの左端X座標 (0 ～ 16-PADDLE_W)
VRAM_BUF:   DS 32           ; ブロック情報を管理するメモリバッファ (32バイト)
                            ; 16行 x 2バイト = 32バイトですが、
                            ; 実際描画するのは上部4行(8バイト)のブロックのみ。
                            ; ここでビットを管理し、0なら空、1ならブロックありとします。

GAME_STATE: DB 0            ; ゲーム状態 (0:プレイ中, 1:ゲームオーバー 予備)

; ----------------------------------------------------------------------------
; プログラム開始 (CODE START)
; ----------------------------------------------------------------------------
    ORG 0x0000
START:
    LD SP, 0xFFFF           ; スタックポインタの初期化 (安全のため)

; ----------------------------------------------------------------------------
; 初期化処理 (INIT_GAME)
; ----------------------------------------------------------------------------
INIT_GAME:
    ; パドルの初期位置 (中央付近)
    LD A, 6
    LD (PADDLE_X), A
    
    ; ボールの初期位置
    LD A, 8
    LD (BALL_X), A
    LD A, 12
    LD (BALL_Y), A
    
    ; ボールの初期速度 (右下へ)
    LD A, 1
    LD (BALL_DX), A
    LD A, 255     ; -1 (2の補数表現)
    LD (BALL_DY), A
    
    ; ゲーム状態クリア
    XOR A
    LD (GAME_STATE), A

    ; ブロック(VRAM)の初期化
    ; 上部4行をすべてブロック(0xFF)で埋めます
    LD HL, VRAM_BUF
    LD B, 8       ; 4行 * 2バイト = 8バイト分
FILL_BRICKS:
    LD (HL), 0xFF ; すべてのビットを1にする
    INC HL
    DJNZ FILL_BRICKS
    
; ----------------------------------------------------------------------------
; メインループ (MAIN_LOOP)
; 1. 入力判定 -> 2. 物理演算 -> 3. 描画 を繰り返します
; ----------------------------------------------------------------------------
MAIN_LOOP:
    ; --- 1. 入力処理 ---
    IN A, (PORT_KEY)        ; キーパッドから入力読み込み
    CP 0xFF                 ; 0xFFなら入力なし
    JR Z, PHYS              ; 入力がなければ物理演算へ
    
    ; キー判定
    CP KEY_LEFT
    JR Z, MV_L              ; '4'なら左移動処理へ
    CP KEY_RIGHT
    JR Z, MV_R              ; '6'なら右移動処理へ
    JR PHYS                 ; その他のキーは無視

MV_L: ; 左移動
    LD A, (PADDLE_X)
    OR A                    ; A=0か？
    JR Z, PHYS              ; 既に左端(0)なら移動しない
    DEC A
    LD (PADDLE_X), A
    JR PHYS

MV_R: ; 右移動
    LD A, (PADDLE_X)
    CP 10                   ; 右端制限 (画面幅16 - パドル幅6 = 10)
    JR Z, PHYS              ; 既に右端なら移動しない
    INC A
    LD (PADDLE_X), A

PHYS:
    ; --- 2. 物理演算 (ボール移動・衝突判定) ---
    CALL DELAY_FRAME        ; ゲーム速度調整用ウェイト

    LD A, (GAME_STATE)
    OR A
    JR NZ, DRAW             ; ゲームオーバーなら更新しない(フリーズ)

    CALL UPDATE_BALL        ; ボールの位置更新と衝突判定

DRAW:
    ; --- 3. 描画処理 ---
    CALL VRAM_TO_MATRIX     ; メモリと変数の状態をハードウェアに出力
    JR MAIN_LOOP            ; 最初に戻る

; ----------------------------------------------------------------------------
; サブルーチン: ボールの更新 (UPDATE_BALL)
; ----------------------------------------------------------------------------
UPDATE_BALL:
    ; --- X軸の更新 ---
    LD A, (BALL_X)
    LD HL, BALL_DX
    ADD A, (HL)             ; X = X + DX
    LD (BALL_X), A
    
    ; 壁判定 (X)
    CP 0
    JR Z, BN_X_P            ; 左壁に当たった -> 右向き(正)反転
    CP 15
    JR Z, BN_X_N            ; 右壁に当たった -> 左向き(負)反転
    JR UPD_Y                ; 壁に当たってなければY軸処理へ

BN_X_P: ; X速度を +1 に
    LD A, 1
    LD (BALL_DX), A
    JR UPD_Y

BN_X_N: ; X速度を -1 に
    LD A, 255
    LD (BALL_DX), A

UPD_Y:
    ; --- Y軸の更新 ---
    LD A, (BALL_Y)
    LD HL, BALL_DY
    ADD A, (HL)             ; Y = Y + DY
    LD (BALL_Y), A
    
    ; 天井判定 (Y=0)
    CP 0
    JR Z, BN_Y_P            ; 天井に当たった -> 下向き(+1)反転
    
    ; パドル判定 (Y >= PADDLE_Y)
    CP PADDLE_Y
    JR NC, CHK_PAD          ; 最下段ならパドルとの衝突チェック
    
    ; ブロック判定
    CALL CHK_BRK            ; ブロックとの衝突チェック
    RET

BN_Y_P: ; Y速度を +1 に
    LD A, 1
    LD (BALL_DY), A
    RET

; パドルとの衝突判定 (CHK_PAD)
CHK_PAD:
    LD A, (BALL_X)          ; ボールのX
    LD B, A
    LD A, (PADDLE_X)        ; パドルの左端X
    SUB B                   ; パドルX - ボールX
    NEG                     ; ボールX - パドルX (パドル左端からの相対位置)
    
    ; ボールがパドルの幅(PADDLE_W)の中にいるか？
    ; 相対位置が 0 ～ (PADDLE_W - 1) ならヒット
    CP PADDLE_W
    JR C, PAD_HIT           ; キャリーフラグ(C)が立てばヒット (A < PADDLE_W)
    
    JP INIT_GAME            ; ミス！ ゲームリセットします
PAD_HIT:
    LD A, 255               ; 上向き(-1)に反転
    LD (BALL_DY), A
    RET

; ブロックとの衝突判定 (CHK_BRK)
CHK_BRK:
    LD A, (BALL_Y)
    CP 4                    ; Y < 4 のエリアがブロック領域
    RET NC                  ; 4以上ならブロックなし
    
    ; ブロックがあるかチェックして、あれば消します
    CALL CLR_BRK
    
    ; ブロックに当たったとしてY速度を反転 (簡易物理)
    LD A, (BALL_DY)
    NEG                     ; 符号反転
    LD (BALL_DY), A
    RET

; 指定位置のブロックを消去 (CLR_BRK)
CLR_BRK:
    ; VRAMのアドレス計算: VRAM_BUF + (BALL_Y * 2) [+1 if X>=8]
    LD A, (BALL_Y)
    ADD A, A                ; Y * 2
    LD C, A                 ; ベースオフセット
    
    LD A, (BALL_X)
    CP 8
    JR C, CB_L              ; X < 8 なら左バイト
    INC C                   ; X >= 8 なら右バイト (オフセット+1)
    SUB 8                   ; ビット計算用にXを 0-7 に正規化
    JR CB_DO
CB_L:
CB_DO:
    ; ここで A = ビット位置(0-7), C = VRAMオフセット
    LD B, A                 ; シフト回数
    
    ; マスク作成 (該当ビットだけ1、他0)
    LD A, 1
    OR A                    ; B=0チェック (シフト不要の場合)
    JR Z, SD
SL: SLA A                   ; 左シフト
    DJNZ SL
SD: CPL                     ; 反転 (該当ビットだけ0、他1)
    LD D, A                 ; マスクをDに保存
    
    ; メモリ読み書き
    LD HL, VRAM_BUF
    LD B, 0
    ADD HL, BC              ; アドレス決定
    LD A, (HL)
    AND D                   ; AND演算でビットを落とす(消去)
    LD (HL), A              ; 書き戻し
    RET

; ----------------------------------------------------------------------------
; 描画ルーチン (VRAM_TO_MATRIX)
; メモリ上のブロック情報、ボール座標、パドル座標を合成して
; ドットマトリクスの各行ポートに出力します。
; ----------------------------------------------------------------------------
VRAM_TO_MATRIX:
    LD B, 0                 ; 現在の行カウンタ (0-15)
    LD HL, VRAM_BUF         ; ブロックデータの参照ポインタ
RL: ; 行ループ開始 (Row Loop)
    PUSH BC                 ; B(行番号)を保存
    PUSH HL                 ; HL(ブロックポインタ)を保存
    
    ; --- 左側 (列 0-7) の描画データ作成 ---
    LD A, B
    CP 4                    ; 4行目未満か？
    JR NC, NB_L             ; 4行目以降はブロック無し(0)
    LD A, (HL)              ; ブロックデータをロード
    JR G_L
NB_L: XOR A                 ; ブロック無しエリアは0
G_L: LD D, A                ; Dレジスタに背景(ブロック)を描画
    
    ; ボール描画 (左側?)
    LD A, (BALL_X)
    CP 8
    JR NC, NBL_L            ; X >= 8 なら左には描画しない
    LD A, (BALL_Y)
    CP B                    ; 現在の行とボールのYが一致するか？
    JR NZ, NBL_L
    ; ボールあり -> ビットを立てる
    LD A, (BALL_X)
    CALL GBM                ; Get Bit Mask (1 << A)
    OR D                    ; 重ね合わせ
    LD D, A
NBL_L:
    
    ; パドル描画 (左側?)
    LD A, B
    CP 15                   ; 15行目(パドル位置)か？
    JR NZ, NP_L
    CALL ADD_P_L            ; パドルのビットを合成
NP_L:
    
    ; ポート出力 (左側)
    LD A, B                 ; 行番号
    ADD A, A                ; x2
    ADD A, 0x80             ; PORT_MAT_BASE(0x80)
    LD C, A                 ; ポートアドレス
    OUT (C), D              ; 出力！
    
    ; --- 右側 (列 8-15) の描画データ作成 ---
    POP HL                  ; HLを復帰して...
    INC HL                  ; 次のバイトへ進める(右側データ)
    PUSH HL                 ; また保存
    
    LD A, B
    CP 4
    JR NC, NB_R
    LD A, (HL)
    JR G_R
NB_R: XOR A
G_R: LD E, A                ; Eレジスタに右側の描画データ作成
    
    ; ボール描画 (右側?)
    LD A, (BALL_X)
    CP 8
    JR C, NBL_R             ; X < 8 なら右には描画しない
    LD A, (BALL_Y)
    CP B
    JR NZ, NBL_R
    ; ボールあり
    LD A, (BALL_X)
    SUB 8                   ; 0-7 に変換
    CALL GBM
    OR E
    LD E, A
NBL_R:

    ; パドル描画 (右側?)
    LD A, B
    CP 15
    JR NZ, NP_R
    CALL ADD_P_R
NP_R:

    ; ポート出力 (右側)
    LD A, B                 ; 行番号
    ADD A, A                ; x2
    ADD A, 0x81             ; 左ポート+1
    LD C, A
    OUT (C), E
    
    ; --- 次の行へ ---
    POP HL                  ; HL復帰
    INC HL                  ; 次の行の左側データへポインタを進める
    POP BC                  ; 行カウンタ復帰
    INC B                   ; 行を進める
    LD A, B
    CP 16                   ; 16行終わった？
    JP NZ, RL               ; まだならループ
    RET

; ----------------------------------------------------------------------------
; ユーティリティ: ビットマスク生成 (GBM: Get Bit Mask)
; 入力 A (0-7) に対し、(1 << A) を A に返します。
; ----------------------------------------------------------------------------
GBM:
    PUSH BC
    AND A           ; 入力Aが0かどうかチェック
    JR Z, GBM_ZERO  ; 0なら特別処理 (ループバグ回避)
    
    LD B, A         ; カウンタにセット
    LD A, 1         ; 初期値 1
GL: SLA A           ; 左シフト
    DJNZ GL         ; B回繰り返す
    POP BC
    RET
GBM_ZERO:
    LD A, 1         ; 0シフト = 1
    POP BC
    RET

; ----------------------------------------------------------------------------
; パドル描画ヘルパー (左側用)
; ----------------------------------------------------------------------------
ADD_P_L:
    PUSH BC         ; 親ルーチンのレジスタを保護
    LD B, PADDLE_W  ; パドル幅分ループ
    LD A, (PADDLE_X)
    LD C, A         ; 現在チェックするドットのX座標
APL_LOOP:
    LD A, C
    CP 8            ; X >= 8 (右側) になったら
    JR NC, APL_N    ; 左側には描かない
    
    ; 左側(0-7)内なので描画
    CALL GBM
    OR D            ; Dレジスタに合成
    LD D, A
APL_N:
    INC C           ; 次のピクセルへ
    DJNZ APL_LOOP   ; 幅分繰り返す
    POP BC          ; レジスタ復帰
    RET

; ----------------------------------------------------------------------------
; パドル描画ヘルパー (右側用)
; ----------------------------------------------------------------------------
ADD_P_R:
    PUSH BC
    LD B, PADDLE_W
    LD A, (PADDLE_X)
    LD C, A
APR_LOOP:
    LD A, C
    CP 8
    JR C, APR_N     ; X < 8 (左側) なら右には描かない
    
    ; 右側(8-15)内なので描画
    SUB 8           ; 0-7に変換
    CALL GBM
    OR E            ; Eレジスタに合成
    LD E, A
APR_N:
    INC C
    DJNZ APR_LOOP
    POP BC
    RET

; ----------------------------------------------------------------------------
; フレームウェイト (DELAY_FRAME)
; ゲーム速度調整用の空ループ
; ----------------------------------------------------------------------------
DELAY_FRAME:
    LD BC, 0x0800   ; 待ち時間カウント
DLPL: DEC BC
    LD A, B
    OR C
    JR NZ, DLPL
    RET
`,

    "Calculator": `; ============================================================================
; KabooZ80 Simulator Simple Calculator (簡易電卓)
; ============================================================================
;
; このプログラムは、キーパッドと7セグメントディスプレイを使用した
; 簡易的な電卓アプリケーションです。以下の数式演算をサポートします。
;   加算 (+), 減算 (-), 乗算 (*), 除算 (/)
;
; ■ ハードウェアマッピング
; 
; [Keypad] (Port 0x40 - 入力)
;   キーを押すと、インターフェースが入力を受け取り、割り込み(INT)が発生します。
;   キーコードのマッピングは以下の通りです：
;     0-9 : 数字入力
;     A   : リセット (Clear All)
;     B   : 加算 (+)
;     C   : 減算 (-)
;     D   : 乗算 (*)
;     #   : 除算 (/)
;     *   : 計算実行 (=)
;
; [7-Segment] (Port 0x10-0x17 - 出力)
;   計算結果や入力値を表示します。
;     0x10 : 左端 (符号表示用 - マイナスの時のみ点灯)
;     0x11 : 桁6 (最上位)
;     ...
;     0x17 : 桁0 (最下位)
;
; ============================================================================

    ; --- リセットベクタ (プログラム開始位置) ---
    ORG 0x0000
    JP START

    ; --- 割り込みベクタ (モード1) ---
    ; キーパッドが押されると、ハードウェアはRST 38Hを実行します
    ORG 0x0038
ISR_KEY:
    IN A, (0x40)            ; キーパッドのポートからキーコードを読み込む
    LD (LAST_KEY), A        ; メモリに保存
    LD A, 1
    LD (KEY_READY), A       ; フラグを立てる (メインループに通知)
    EI                      ; 割り込み許可 (次の入力のため)
    RETI                    ; 割り込み復帰

; ============================================================================

    ; --- メモリマップ (変数定義) ---
    ; RAMエリア (0x8000以降を使用)
    VAL_L   EQU 0x8000  ; 現在入力中の数値 (下位8bit)
    VAL_H   EQU 0x8001  ; 現在入力中の数値 (上位8bit)
    ACC_L   EQU 0x8002  ; 演算用アキュムレータ (下位8bit) - 計算結果など
    ACC_H   EQU 0x8003  ; 演算用アキュムレータ (上位8bit)
    OP_CODE EQU 0x8004  ; 演算子コード (0=なし, 1=+, 2=-, 3=*, 4=/)
    IS_NEW  EQU 0x8005  ; 新規入力フラグ (1なら次の数字入力でVALをクリア)
    LAST_KEY EQU 0x8006 ; 最後に押されたキーコード
    KEY_READY EQU 0x8007 ; キー入力済みフラグ

    ; --- 定数 (演算コード) ---
    KEY_NONE EQU 0xFF
    OP_NONE  EQU 0
    OP_ADD   EQU 1
    OP_SUB   EQU 2
    OP_MUL   EQU 3
    OP_DIV   EQU 4

    ; --- プログラム開始 (START) ---
START:
    LD SP, 0xFFFF           ; スタックポインタ初期化
    CALL RESET_ALL          ; 変数・表示の初期化
    IM 1                    ; 割り込みモード1 (RST 38H) に設定
    EI                      ; 割り込み有効化

; ----------------------------------------------------------------------------
; メインループ (イベント待ち受け)
; ----------------------------------------------------------------------------
MAIN_LOOP:
    ; キー入力待ち (割り込み処理で KEY_READY が 1 になるのを待つ)
    LD A, (KEY_READY)
    OR A
    JR Z, MAIN_LOOP
    
    ; キー入力あり
    XOR A
    LD (KEY_READY), A       ; フラグクリア (二重処理防止)
    
    ; キー処理実行
    LD A, (LAST_KEY)
    CALL PROCESS_KEY        ; キーの内容に応じて計算や数値追加
    CALL UPDATE_DISPLAY     ; 画面更新
    
    JR MAIN_LOOP            ; 繰り返し

; ============================================================================
; キー入力処理ルーチン (PROCESS_KEY)
; 入力 A : キーコード
; ============================================================================
PROCESS_KEY:
    ; 特殊キー(演算子など)の判定
    CP 12           ; '*' キー (キーコード12) -> イコール(=)扱い
    JP Z, KEY_EQ
    CP 14           ; '#' キー (キーコード14) -> 除算(/)扱い
    JP Z, KEY_DIV
    CP 15           ; 'D' キー (キーコード15) -> 乗算(*)扱い
    JP Z, KEY_MUL
    CP 11           ; 'C' キー (キーコード11) -> 減算(-)扱い
    JP Z, KEY_SUB
    CP 7            ; 'B' キー (キーコード7)  -> 加算(+)扱い
    JP Z, KEY_ADD
    CP 3            ; 'A' キー (キーコード3)  -> リセット(AC)扱い
    JP Z, RESET_ALL
    
    ; 数字キーの処理
    ; キーコードを実際の数値(0-9)に変換します
    LD B, A         ; キーコードを保存
    LD HL, KEY_MAP  ; 変換テーブル
    LD C, 0         ; カウンタ (数値)
MAP_LOOP:
    LD A, (HL)
    CP 0xFF         ; テーブル終端
    RET Z           ; 無効なキーなら無視
    CP B            ; キーコード一致？
    JR Z, FOUND_DIGIT
    INC HL
    INC C
    JR MAP_LOOP

FOUND_DIGIT:
    LD A, C         ; A レジスタに数値 (0-9) が入る
    
    ; 新規入力モードかチェック (演算子を押した直後など)
    LD HL, IS_NEW
    LD B, (HL)
    LD (HL), 0      ; フラグクリア
    LD A, B
    OR A
    JR Z, APPEND_DIGIT
    
    ; 新しい数値入力開始 -> 現在の入力値(VAL)をクリア
    LD HL, 0
    LD (VAL_L), HL
    
APPEND_DIGIT:
    ; 入力値の更新: VAL = VAL * 10 + Digit
    LD HL, (VAL_L)
    
    ; HL = HL * 10
    PUSH HL
    POP DE          ; DE = HL
    ADD HL, HL      ; HL * 2
    ADD HL, HL      ; HL * 4
    ADD HL, DE      ; HL * 5
    ADD HL, HL      ; HL * 10
    
    LD A, C         ; 追加する桁の数値
    LD E, A
    LD D, 0
    ADD HL, DE      ; HL + Digit
    
    LD (VAL_L), HL  ; 保存
    RET


; --- 演算子キー処理群 ---
KEY_ADD:
    LD A, OP_ADD
    JR DO_OP
KEY_SUB:
    LD A, OP_SUB
    JR DO_OP
KEY_MUL:
    LD A, OP_MUL
    JR DO_OP
KEY_DIV:
    LD A, OP_DIV
    JR DO_OP
KEY_EQ:
    LD A, OP_NONE
    ; Fallthrough (イコールの場合は演算予約なしで実行のみ)

DO_OP:
    LD C, A         ; 新しい演算子をCに保存
    
    ; 既に保留中の演算があれば実行 (例: 1 + 2 [+] -> この時点で 1+2 を計算)
    LD A, (OP_CODE)
    OR A
    JR Z, SET_NEW_OP
    
    ; 保留中の計算を実行: ACC = ACC <OP> VAL
    CALL EXEC_OP
    
    ; 結果を入力値(VAL)にコピーして表示させる
    LD HL, (ACC_L)
    LD (VAL_L), HL
    
SET_NEW_OP:
    LD A, C
    LD (OP_CODE), A ; 次の演算子を保存
    
    ; 現在の値をアキュムレータ(ACC)へ移動
    LD HL, (VAL_L)
    LD (ACC_L), HL
    
    ; 次の数字入力でVALをクリアするためのフラグセット
    LD A, 1
    LD (IS_NEW), A
    RET

; --- 計算実行ルーチン ---
EXEC_OP:
    LD HL, (ACC_L)  ; 左辺 (被演算子)
    LD DE, (VAL_L)  ; 右辺 (演算子)
    
    LD A, (OP_CODE)
    CP OP_ADD
    JR Z, OP_ADD_IMPL
    CP OP_SUB
    JR Z, OP_SUB_IMPL
    CP OP_MUL
    JR Z, OP_MUL_IMPL
    CP OP_DIV
    JR Z, OP_DIV_IMPL
    RET

OP_ADD_IMPL: ; 加算
    ADD HL, DE
    LD (ACC_L), HL
    RET

OP_SUB_IMPL: ; 減算
    OR A            ; キャリークリア
    SBC HL, DE
    LD (ACC_L), HL
    RET

OP_MUL_IMPL: ; 乗算 (符号なし16bit)
    ; HL = HL * DE
    ; シフト加算アルゴリズム
    LD B, H
    LD C, L         ; BC = 左辺
    LD HL, 0        ; 結果初期化
    LD A, 16        ; 16ビット分ループ
MUL_LOOP:
    ADD HL, HL      ; 結果を左シフト
    EX DE, HL
    ADD HL, HL      ; 右辺(DE)を左シフトして最上位ビットをCarryへ
    EX DE, HL
    JR NC, NO_ADD   ; Carryがなければ加算スキップ
    ADD HL, BC      ; 結果に左辺を加算
NO_ADD:
    DEC A
    JR NZ, MUL_LOOP
    LD (ACC_L), HL
    RET

OP_DIV_IMPL: ; 除算 (符号なし16bit)
    ; HL = HL / DE
    ; 0除算チェック
    LD A, D
    OR E
    RET Z           ; 0除算なら何もしない
    
    ; 割り算の準備
    ; HL = 被除数 (Dividend) -> ACC
    ; DE = 除数 (Divisor)   -> VAL
    
    ; 筆算アルゴリズム用レジスタ割り当て変更
    LD B, D
    LD C, E         ; BC = 除数
    LD DE, 0        ; DE = 余り (Remainder) 初期化
    
    LD A, 16        ; ループ回数
    AND A           ; キャリークリア

DIV_LOOP:
    ; 1. 被除数(HL)を左シフト。MSBがキャリーへ。
    ADD HL, HL
    
    ; 2. 余り(DE)を左シフトし、下位ビットにキャリーを取り込む
    EX DE, HL
    ADC HL, HL
    EX DE, HL
    
    ; 3. 余りから除数を引けるか試行 (DE - BC)
    PUSH HL         ; HL(商/被除数)を退避
    LD H, D
    LD L, E         ; HL = 余り
    OR A            ; キャリークリア
    SBC HL, BC      ; 余り - 除数
    
    JR C, DIV_SKIP  ; 引けない(Carry発生)ならスキップ
    
    ; 引けた場合
    LD D, H
    LD E, L         ; 新しい余りをDEに戻す
    
    POP HL          ; HL復帰
    INC HL          ; 商の最下位ビットを1にする
    JR DIV_NEXT_ITER

DIV_SKIP:
    POP HL          ; HL復帰 (ビットは0のまま)

DIV_NEXT_ITER:
    DEC A
    JR NZ, DIV_LOOP
    
    ; HLが商、DEが余りになります
    LD (ACC_L), HL
    RET

; --- 全リセット処理 ---
RESET_ALL:
    LD HL, 0
    LD (VAL_L), HL
    LD (ACC_L), HL
    LD A, 0
    LD (OP_CODE), A
    LD (IS_NEW), A
    LD (KEY_READY), A
    CALL UPDATE_DISPLAY
    RET

; ============================================================================
; 表示更新ルーチン (7セグメント制御)
; ============================================================================
UPDATE_DISPLAY:
    LD HL, (VAL_L)
    
    ; 負の数チェック
    BIT 7, H
    JR Z, POSITIVE
    ; 負の場合
    LD A, 0x40      ; '-' のセグメントパターン
    OUT (0x10), A   ; 符号桁(ポート0x10)に出力
    
    ; 表示用に数値を正の数(絶対値)に変換 (2の補数)
    LD A, H
    CPL
    LD H, A
    LD A, L
    CPL
    LD L, A
    INC HL
    JR DISP_VAL
POSITIVE:
    LD A, 0         ; 消灯
    OUT (0x10), A   ; 符号桁

DISP_VAL:
    ; HLの値をBCD(10進数)の各桁に分解して表示
    ; 右端(ポート0x17)から順に埋めていきます
    
    LD C, 0x17      ; 開始ポート (右端)
    LD B, 7         ; 最大7桁 (0x17 -> 0x11)
    
CONV_LOOP:
    ; HL ÷ 10 を行い、余り(A)を表示
    CALL DIV_10     ; HL=商, A=余り
    
    PUSH HL         ; 商を保存
    
    ; 余り(0-9)をセグメントパターンに変換
    LD HL, SEG_MAP
    LD E, A
    LD D, 0
    ADD HL, DE
    LD A, (HL)
    OUT (C), A      ; 出力
    DEC C           ; 次の桁へ (左隣)
    
    POP HL          ; 商を復帰
    
    ; ゼロサプレス処理 (上位桁の不要な0を消す)
    ; 商(HL)が0なら残りは空白にする
    LD A, H
    OR L
    JR NZ, NOT_ZERO
    
    ; 商が0になったので、残りの桁を空白埋め
    DEC B           ; 今表示した桁をカウントから除く
    JP Z, DISP_DONE ; 全桁完了なら終了
    
BLANK_LOOP:
    XOR A           ; 0x00 (Blank)
    OUT (C), A
    DEC C
    DJNZ BLANK_LOOP
    RET             ; 終了

NOT_ZERO:
    DJNZ CONV_LOOP  ; 次の桁へ
    RET

DISP_DONE:
    RET

; [ヘルパー] HL = HL / 10, A = 余り
DIV_10:
    PUSH BC
    LD B, 16        ; 16ビット分
    LD C, 10        ; 除数
    XOR A           ; 余り初期化
D10_LOOP:
    ADD HL, HL      ; 被除数シフト
    RLA             ; 余りシフト(キャリー込み)
    CP C            ; 余り >= 10 ?
    JR C, D10_NEXT
    SUB C           ; 余り - 10
    INC L           ; 商のビットを立てる
D10_NEXT:
    DJNZ D10_LOOP
    POP BC
    RET

; --- データテーブル ---

; 数値 -> 7セグメントパターン変換表
; (g f e d c b a) のビット対応
SEG_MAP:
    DB 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F

; キーコード -> 数値(0-9)変換表
; インデックスが数値、値が対応するキーコード
KEY_MAP:
    DB 13       ; 0 のキーコード
    DB 0        ; 1
    DB 1        ; 2
    DB 2        ; 3
    DB 4        ; 4
    DB 5        ; 5
    DB 6        ; 6
    DB 8        ; 7
    DB 9        ; 8
    DB 10       ; 9
    DB 0xFF     ; 終端
`,

    "Input Test": `; ============================================================================
; INPUT DEVICE TEST (入力デバイス・割り込みテスト)
; ============================================================================
;
; このプログラムは、割り込み(Interrupt)と入力デバイスの連動をテストします。
;
; 1. Push Buttons (Port 0x60) :
;      ボタンを押すと、対応する7セグメントLEDに「8」が約3秒間表示されます。
;      入力検知に割り込み(Interrupts)を使用しています。
;
; 2. DIP Switches (Port 0x50-0x57) :
;      スイッチをONにすると、対応するLED (Port 0x00) が点灯します。
;      メインループでのポーリング監視です。
;
; 3. Keypad (Port 0x40) :
;      キーを押すと、ドットマトリクス上の特定の位置が約3秒間点灯します。
;      入力検知に割り込みを使用しています。
;
; ============================================================================

    ; --- リセットベクタ ---
    ORG 0x0000
    JP START

    ; --- 割り込みベクタ (モード1 / RST 38H) ---
    ; 割り込みが発生するとここに飛びます
    ORG 0x0038
    DI                      ; 二重割り込み禁止
    PUSH AF                 ; レジスタ退避
    PUSH BC
    PUSH DE
    PUSH HL
    
    CALL HANDLE_INT         ; 割り込み処理本体へ
    
    POP HL                  ; レジスタ復帰
    POP DE
    POP BC
    POP AF
    EI                      ; 割り込み許可
    RETI                    ; 割り込み復帰

; ----------------------------------------------------------------------------
; 定数定義
; ----------------------------------------------------------------------------
PORT_LED        EQU 0x00    ; 出力: LED
PORT_7SEG_BASE  EQU 0x10    ; 出力: 7セグメント (0x10-0x17)
PORT_LCD_CMD    EQU 0x20
PORT_LCD_DAT    EQU 0x21
PORT_KEYPAD     EQU 0x40    ; 入力: キーパッド
PORT_DIP_BASE   EQU 0x50    ; 入力: DIPスイッチ (0x50-0x57)
PORT_BTN        EQU 0x60    ; 入力: プッシュボタン (Bit 0-7)
PORT_MATRIX_BASE EQU 0x80   ; 出力: ドットマトリクス
PORT_RTC_SEC    EQU 0xC0    ; 入力: RTC秒カウンター
SEG_8           EQU 0x7F    ; '8' のセグメントパターン

; ----------------------------------------------------------------------------
; メインプログラム
; ----------------------------------------------------------------------------
    ORG 0x0100
START:
    LD SP, 0xFFFF
    IM 1                    ; 割り込みモード1 (RST 38H)
    EI                      ; 割り込み有効化

    ; --- 変数初期化 ---
    XOR A
    LD (LAST_SEC), A
    LD (TIMER_MATRIX), A
    
    ; 7セグメント用タイマー(8個)をクリア
    LD HL, TIMER_7SEG
    LD B, 8
INIT_VAR_L:
    LD (HL), 0
    INC HL
    DJNZ INIT_VAR_L

MAIN_LOOP:
    ; 1. DIPスイッチの状態を読み取り、LEDに反映 (ポーリング)
    CALL PROCESS_DIPS
    
    ; 2. タイマーの減算処理 (RTC秒に基づく)
    CALL PROCESS_TIMERS
    
    ; 3. タイマー値に基づいて表示を更新
    CALL UPDATE_DISPLAYS
    
    JP MAIN_LOOP            ; 繰り返し

; ============================================================================
; サブルーチン: DIPスイッチ処理
; DIPスイッチ(0x50-0x57の各Bit0)を読み取り、1つのバイトにまとめてLEDに出力
; ============================================================================
PROCESS_DIPS:
    LD C, 0x50     ; DIPベースポート
    LD B, 0        ; 結果蓄積用
    LD E, 1        ; ビットマスク (00000001 -> 00000010 -> ...)
    LD D, 8        ; 8スイッチ分ループ
DIP_L:
    PUSH BC        ; Cレジスタを破壊しないよう保存
    LD B, 0
    IN A, (C)      ; ポート読み込み (ONなら1、OFFなら0)
    AND 1          ; 最下位ビットのみ有効
    JR Z, DIP_O    ; 0ならスキップ
    POP BC
    LD A, B
    OR E           ; 対応するビットを立てる
    LD B, A
    JR DIP_N
DIP_O:
    POP BC
DIP_N:
    RLC E          ; マスクを左シフト
    INC C          ; 次のポートへ
    DEC D
    JR NZ, DIP_L
    
    ; 結果をLEDに出力
    LD A, B
    OUT (PORT_LED), A
    RET

; ============================================================================
; サブルーチン: タイマー処理
; RTCの秒カウント監視し、変化があったら各種タイマー変数をデクリメントします
; ============================================================================
PROCESS_TIMERS:
    IN A, (PORT_RTC_SEC)    ; 現在の秒を取得
    LD HL, LAST_SEC
    CP (HL)
    RET Z                   ; 秒が変わっていなければリターン
    
    ; 1秒経過
    LD (HL), A              ; 秒を保存
    
    ; マトリクス表示タイマー減算
    LD A, (TIMER_MATRIX)
    OR A
    JR Z, PRO_7
    DEC A
    LD (TIMER_MATRIX), A
    
PRO_7:
    ; 7セグメント表示タイマー(8個)減算
    LD HL, TIMER_7SEG
    LD B, 8
T7_L:
    LD A, (HL)
    OR A
    JR Z, T7_N
    DEC (HL)                ; タイマー > 0 なら -1
T7_N:
    INC HL
    DJNZ T7_L
    RET

; ============================================================================
; サブルーチン: 表示更新
; タイマー変数が > 0 のデバイスを点灯させます
; ============================================================================
UPDATE_DISPLAYS:
    ; --- 7セグメント ---
    LD C, PORT_7SEG_BASE
    LD HL, TIMER_7SEG
    LD B, 8
U7_L:
    LD A, (HL)
    OR A
    LD A, 0
    JR Z, U7_O              ; タイマー=0なら消灯
    LD A, SEG_8             ; タイマー>0なら '8' を表示
U7_O:
    OUT (C), A
    INC C
    INC HL
    DJNZ U7_L
    
    ; --- ドットマトリクス ---
    LD A, (TIMER_MATRIX)
    OR A
    JR Z, CLR_M             ; タイマー=0なら全消灯
    
    CALL CLR_M              ; 一旦消して
    
    ; MATRIX_R(行), MATRIX_C(列) の位置だけ点灯
    ; ポートアドレス計算 (0x80 + R*2 [+1 if C>=8])
    LD A, (MATRIX_R)
    ADD A, A
    ADD A, 0x80
    LD C, A
    LD A, (MATRIX_C)
    CP 8
    JR C, COL_L
    INC C                   ; 右側
    SUB 8
COL_L:
    ; ビットマスク作成 (1 << A)
    LD B, A
    LD A, 1
    OR A
    INC B
SH_L:
    DEC B
    JR Z, SH_D
    SLA A
    JR SH_L
SH_D:
    OUT (C), A              ; 点灯
    RET

CLR_M: ; マトリクス全消去
    LD C, 0x80
    LD B, 32
    XOR A
CM_L:
    OUT (C), A
    INC C
    DJNZ CM_L
    RET

; ============================================================================
; 割り込みハンドラ (HANDLE_INT)
; ボタンやキー入力を検知し、タイマーをセットします
; ============================================================================
HANDLE_INT:
    ; 1. プッシュボタンチェック (0x60)
    IN A, (PORT_BTN)
    OR A
    JR Z, CHK_K             ; ボタン入力なし
    
    ; ビット0-7が各ボタンに対応
    ; 押されたボタンに対応する7セグタイマーをセット(3秒)
    LD HL, TIMER_7SEG
    LD B, 8
SB_L:
    RRA                     ; 最下位ビットをCarryへ
    JR NC, SB_N             ; 0なら押されていない
    LD (HL), 3              ; タイマーセット
SB_N:
    INC HL
    DJNZ SB_L
    
CHK_K:
    ; 2. キーパッドチェック (0x40)
    IN A, (PORT_KEYPAD)
    CP 0xFF
    RET Z                   ; 入力なし
    
    ; 簡易的な座標計算
    ; キーコードをもとに適当なマトリクス座標(R, C)を決定
    LD B, A
    SRL A
    SRL A
    ADD A, A
    ADD A, A
    LD (MATRIX_R), A        ; 行
    LD A, B
    AND 0x03
    ADD A, A
    ADD A, A
    LD (MATRIX_C), A        ; 列
    
    LD A, 3
    LD (TIMER_MATRIX), A    ; マトリクスタイマーセット(3秒)
    RET

; ----------------------------------------------------------------------------
; ワークエリア (Variables)
; ----------------------------------------------------------------------------
    ORG 0x8000
LAST_SEC:       DB 0        ; 秒保存用
TIMER_7SEG:     DS 8        ; 7セグ各桁のタイマー
TIMER_MATRIX:   DB 0        ; マトリクスのタイマー
MATRIX_R:       DB 0        ; 点灯位置 行
MATRIX_C:       DB 0        ; 点灯位置 列
`,

    "CPU Verification": `; ============================================================================
; COMPREHENSIVE Z80 VERIFICATION SUITE (Z80 CPU命令 総合検証テスト)
; Based on instruction_set.html
; ============================================================================
;
; このプログラムは、シミュレータのZ80 CPUコア実装が正しいかを検証するための一連のテストです。
; 各セクションで特定の命令グループ（ロード、算術演算、論理演算など）を実行し、
; 結果が期待通りかどうかをチェックします。
;
; ■ テスト結果の表示
; 
;   [成功時 (SUCCESS)]
;     - 緑色LED点灯 (Port 0x00, Bit 0)
;     - 7セグメントディスプレイに 'P' (Pass) を表示 (Port 0x17)
;
;   [失敗時 (FAILURE)]
;     - 赤色LED点灯 (Port 0x00, Bit 7)
;     - 7セグメントディスプレイに失敗したセクション番号を表示 (Port 0x10)
; ============================================================================

    ORG 0x0000
    JP START

; ----------------------------------------------------------------------------
; 成功時の処理
; ----------------------------------------------------------------------------
SUCCESS:
    LD A, 0x01
    OUT (0x00), A   ; 緑LED点灯
    LD A, 0x73      ; 'P' のセグメントパターン
    OUT (0x17), A   ; 右端の7セグに表示
    HALT            ; 停止

; ----------------------------------------------------------------------------
; 失敗時の処理 (AレジスタにエラーIDを入れてジャンプ)
; ----------------------------------------------------------------------------
ERROR:
    OUT (0x10), A   ; エラーIDを左端の7セグに表示
    LD A, 0x80
    OUT (0x00), A   ; 赤LED点灯
    HALT            ; 停止

; ----------------------------------------------------------------------------
; メインテストシーケンス
; ----------------------------------------------------------------------------
START:
    LD SP, 0xFFFF   ; スタック初期化

    ; --------------------------------------------------------
    ; SECTION 1: 8-BIT LOADS (8ビット転送命令)
    ; --------------------------------------------------------
    LD A, 0x11 : CP 0x11 : JP NZ, FAIL_1        ; 即値ロード
    LD B, A : LD A, B : CP 0x11 : JP NZ, FAIL_1 ; レジスタ間転送
    LD HL, 0x8000 : LD (HL), 0x55 : LD A, (HL) : CP 0x55 : JP NZ, FAIL_1 ; メモリ間接
    LD IX, 0x8010 : LD (IX+2), 0xAA : LD A, (IX+2) : CP 0xAA : JP NZ, FAIL_1 ; インデックス修飾

    ; --------------------------------------------------------
    ; SECTION 2: 16-BIT LOADS (16ビット転送命令)
    ; --------------------------------------------------------
    LD BC, 0x1234 : LD DE, 0x5678               ; 16ビット即値
    LD HL, 0x9ABC : LD (0x8020), HL : LD HL, 0 : LD HL, (0x8020) ; 16ビット直接
    LD A, H : CP 0x9A : JP NZ, FAIL_2
    PUSH BC : POP DE : LD A, D : CP 0x12 : JP NZ, FAIL_2 ; スタック操作

    ; --------------------------------------------------------
    ; SECTION 3: EXCHANGE & BLOCK (交換・ブロック転送)
    ; --------------------------------------------------------
    EX DE, HL : LD A, D : CP 0x9A : JP NZ, FAIL_3 ; 交換
    ; LDI (Load Increment)
    LD HL, 0x8030 : LD DE, 0x8031 : LD (HL), 0x99 : LD BC, 1 : LDI : LD A, (0x8031) : CP 0x99 : JP NZ, FAIL_3
    ; CPIR (Compare Increment Repeat)
    LD HL, 0x8040 : LD (HL), 0x10 : INC HL : LD (HL), 0x20 : LD HL, 0x8040 : LD BC, 5 : LD A, 0x20 : CPIR : JP NZ, FAIL_3

    ; --------------------------------------------------------
    ; SECTION 4: ARITHMETIC (算術演算)
    ; --------------------------------------------------------
    LD A, 10 : ADD A, 20 : CP 30 : JP NZ, FAIL_4 ; 加算
    LD A, 5 : INC A : CP 6 : JP NZ, FAIL_4       ; インクリメント
    NEG : CP 0xFA : JP NZ, FAIL_4                ; 符号反転 (2の補数: -6 = 0xFA)

    ; --------------------------------------------------------
    ; SECTION 5: LOGICAL (論理演算)
    ; --------------------------------------------------------
    LD A, 0xF0 : AND 0x0F : CP 0 : JP NZ, FAIL_5 ; AND
    XOR A : CP 0 : JP NZ, FAIL_5                 ; XOR (ゼロクリア)

    ; --------------------------------------------------------
    ; SECTION 6: ROTATE & SHIFT (回転・シフト)
    ; --------------------------------------------------------
    LD A, 0x80 : RLCA : CP 0x01 : JP NZ, FAIL_6  ; 左回転 (Bit7 -> Bit0)
    LD C, 0x01 : RRC C : LD A, C : CP 0x80 : JP NZ, FAIL_6 ; 右回転 (Bit0 -> Bit7)

    ; --------------------------------------------------------
    ; SECTION 7: BIT OPS (ビット操作)
    ; --------------------------------------------------------
    LD E, 0 : SET 4, E : BIT 4, E : JP Z, FAIL_7 ; ビットセット & テスト
    RES 4, E : LD A, E : CP 0 : JP NZ, FAIL_7    ; ビットリセット

    ; --------------------------------------------------------
    ; SECTION 8: JUMPS (ジャンプ・ループ)
    ; --------------------------------------------------------
    JR SKIP_JR      ; 相対ジャンプ
    JP FAIL_8       ; ここに来たら失敗
SKIP_JR:
    LD B, 3 : LD A, 0
LOOP_B: INC A : DJNZ LOOP_B : CP 3 : JP NZ, FAIL_8 ; DJNZループ

    ; --------------------------------------------------------
    ; SECTION 9: STACK (スタック操作詳細)
    ; --------------------------------------------------------
    LD HL, 0xABCD : PUSH HL : LD HL, 0 : EX (SP), HL : LD A, H : CP 0xAB : JP NZ, FAIL_9 : POP HL

    ; 全テスト通過
    JP SUCCESS

; ----------------------------------------------------------------------------
; 失敗ハンドラ定義
; ----------------------------------------------------------------------------
FAIL_1: LD A, 1 : JP ERROR
FAIL_2: LD A, 2 : JP ERROR
FAIL_3: LD A, 3 : JP ERROR
FAIL_4: LD A, 4 : JP ERROR
FAIL_5: LD A, 5 : JP ERROR
FAIL_6: LD A, 6 : JP ERROR
FAIL_7: LD A, 7 : JP ERROR
FAIL_8: LD A, 8 : JP ERROR
FAIL_9: LD A, 9 : JP ERROR
`

};
