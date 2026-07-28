Attribute VB_Name = "modApproval"
Option Explicit

' 「承認」シートの申請待ち一覧を履歴シートから再構築する。
' 交換申請は同じ申請IDの行が2行(対象者ごと)続けて並ぶため、一覧上でも
' 「誰の申請で・誰の・どんな変更か」が行ごとに具体的に見える。
Public Sub RefreshPendingList()
    Dim hist As Worksheet, appr As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Set appr = ThisWorkbook.Sheets("承認")

    Const FIRST_DATA_ROW As Long = 13

    Dim lastClear As Long
    lastClear = appr.Cells(appr.Rows.Count, 1).End(xlUp).Row
    If lastClear >= FIRST_DATA_ROW Then
        appr.Range(appr.Cells(FIRST_DATA_ROW, 1), appr.Cells(lastClear, 8)).ClearContents
    End If

    Dim lastHistRow As Long
    lastHistRow = hist.Cells(hist.Rows.Count, 1).End(xlUp).Row

    Dim outRow As Long
    outRow = FIRST_DATA_ROW
    Dim r As Long
    For r = 2 To lastHistRow
        If CStr(hist.Cells(r, 9).Value) = "申請中" Then
            appr.Cells(outRow, 1).Value = hist.Cells(r, 1).Value  ' 申請ID
            appr.Cells(outRow, 2).Value = hist.Cells(r, 3).Value  ' 申請者
            appr.Cells(outRow, 3).Value = hist.Cells(r, 4).Value  ' 対象者
            appr.Cells(outRow, 4).Value = hist.Cells(r, 5).Value  ' 対象日
            appr.Cells(outRow, 4).NumberFormat = "yyyy/mm/dd"
            appr.Cells(outRow, 5).Value = hist.Cells(r, 6).Value  ' 変更前
            appr.Cells(outRow, 6).Value = hist.Cells(r, 7).Value  ' 変更後
            appr.Cells(outRow, 7).Value = hist.Cells(r, 8).Value  ' 変更理由
            appr.Cells(outRow, 8).Value = hist.Cells(r, 2).Value  ' 申請日時
            appr.Cells(outRow, 8).NumberFormat = "yyyy/mm/dd hh:mm:ss"
            outRow = outRow + 1
        End If
    Next r

    Dim lastRow As Long
    lastRow = appr.Cells(appr.Rows.Count, 1).End(xlUp).Row
    With appr.Range("B3").Validation
        .Delete
        If lastRow >= FIRST_DATA_ROW Then
            .Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, _
                 Formula1:="=承認!$A$" & FIRST_DATA_ROW & ":$A$" & lastRow
        End If
    End With
End Sub

' 「承認」シートの入力内容にもとづき、承認または却下を実行する。
' 同一申請IDに紐づく履歴行(単独申請なら1行、交換申請なら2行)をまとめて処理する。
' シフト表への反映は、全対象セルの特定・競合チェックを終えてからまとめて書き込む
' (交換申請で片方だけ反映されてしまう事態を避けるため)。
Public Sub ProcessApproval()
    Dim appr As Worksheet
    Set appr = ThisWorkbook.Sheets("承認")

    Dim targetId As String, apprName As String, pwd As String, decision As String
    targetId = Trim$(CStr(appr.Range("B3").Value))
    apprName = Trim$(CStr(appr.Range("B4").Value))
    pwd = CStr(appr.Range("B5").Value)
    decision = Trim$(CStr(appr.Range("B6").Value))

    If targetId = "" Then
        MsgBox "対象の申請IDを選択してください。", vbExclamation
        Exit Sub
    End If
    If apprName = "" Then
        MsgBox "承認者氏名を入力してください。", vbExclamation
        Exit Sub
    End If
    If decision <> "承認" And decision <> "却下" Then
        MsgBox "判定は「承認」または「却下」を選択してください。", vbExclamation
        Exit Sub
    End If

    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")
    Dim staffRow As Long
    staffRow = FindStaffMasterRow(apprName)
    If staffRow = 0 Then
        MsgBox apprName & " は職員マスタに登録されていません。", vbCritical
        Exit Sub
    End If
    If InStr(CStr(masterWs.Cells(staffRow, 2).Value), "承認者") = 0 Then
        MsgBox apprName & " には承認権限がありません。", vbCritical
        Exit Sub
    End If

    Dim salt As String, storedHash As String
    salt = CStr(masterWs.Cells(staffRow, 3).Value)
    storedHash = CStr(masterWs.Cells(staffRow, 4).Value)
    If Not VerifyPassword(pwd, salt, storedHash) Then
        MsgBox "パスワードが正しくありません。", vbCritical
        appr.Range("B5").Value = ""
        Exit Sub
    End If

    Dim hist As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Dim rows As Collection
    Set rows = FindHistoryRowsById(targetId)
    If rows.Count = 0 Then
        MsgBox "対象の申請が見つかりません。既に処理済みの可能性があります。", vbCritical
        RefreshPendingList
        Exit Sub
    End If

    Dim rw As Variant
    For Each rw In rows
        If CStr(hist.Cells(CLng(rw), 9).Value) <> "申請中" Then
            MsgBox "この申請は既に処理済みです。", vbExclamation
            RefreshPendingList
            Exit Sub
        End If
    Next rw

    Dim r As Long

    If decision = "却下" Then
        For Each rw In rows
            r = CLng(rw)
            hist.Cells(r, 9).Value = "却下"
            hist.Cells(r, 10).Value = apprName
            hist.Cells(r, 11).Value = Now
            hist.Cells(r, 11).NumberFormat = "yyyy/mm/dd hh:mm:ss"
        Next rw
        MsgBox "申請を却下しました。", vbInformation
    Else
        Dim shiftWs As Worksheet
        Set shiftWs = ThisWorkbook.Sheets("シフト表")

        Dim n As Long
        n = rows.Count
        Dim shiftRows() As Long, shiftCols() As Long, newShifts() As String
        ReDim shiftRows(1 To n)
        ReDim shiftCols(1 To n)
        ReDim newShifts(1 To n)

        Dim staffName As String, targetDate As Date, newShift As String
        Dim sRow As Long, sCol As Long
        Dim actualCurrent As String
        Dim conflictMsg As String
        Dim idx As Long
        idx = 0
        For Each rw In rows
            idx = idx + 1
            r = CLng(rw)
            staffName = CStr(hist.Cells(r, 4).Value)
            targetDate = CDate(hist.Cells(r, 5).Value)
            newShift = CStr(hist.Cells(r, 7).Value)

            sRow = FindShiftStaffRow(staffName)
            sCol = FindShiftDayColumn(Day(targetDate))
            If sRow = 0 Or sCol = 0 Then
                MsgBox "シフト表の対象セルが見つかりません(" & staffName & ")。管理者に確認してください。", vbCritical
                Exit Sub
            End If
            shiftRows(idx) = sRow
            shiftCols(idx) = sCol
            newShifts(idx) = newShift

            actualCurrent = CStr(shiftWs.Cells(sRow, sCol).Value)
            If actualCurrent <> CStr(hist.Cells(r, 6).Value) Then
                conflictMsg = conflictMsg & staffName & "(" & Format(targetDate, "m/d") & "): 現在「" & actualCurrent & _
                              "」/ 申請時の前提「" & hist.Cells(r, 6).Value & "」" & vbCrLf
            End If
        Next rw

        If conflictMsg <> "" Then
            If MsgBox("シフト表の現在値が申請時と異なる箇所があります。" & vbCrLf & conflictMsg & vbCrLf & _
                      "このまま上書きしてよろしいですか?", vbYesNo + vbExclamation) = vbNo Then
                Exit Sub
            End If
        End If

        idx = 0
        For Each rw In rows
            idx = idx + 1
            r = CLng(rw)
            shiftWs.Cells(shiftRows(idx), shiftCols(idx)).Value = newShifts(idx)

            hist.Cells(r, 9).Value = "承認"
            hist.Cells(r, 10).Value = apprName
            hist.Cells(r, 11).Value = Now
            hist.Cells(r, 11).NumberFormat = "yyyy/mm/dd hh:mm:ss"
        Next rw

        MsgBox "承認しました。シフト表に反映しました。(" & n & "件)", vbInformation
    End If

    appr.Range("B3").Value = ""
    appr.Range("B5").Value = ""
    appr.Range("B6").Value = ""

    RefreshPendingList
    RefreshApprovedList
    ThisWorkbook.Save
End Sub
